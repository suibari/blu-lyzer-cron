import { WebSocket } from 'ws';
import { supabase } from '../lib/supabase.js';
import { getNouns } from '../wordfreq.js';
import { calculateEMA } from '../statistics/average.js';

const SPAN_CALC_EMA = 60 * 60 * 1000; // 1hour
// const SPAN_CALC_EMA = 60 * 1000; // 1min: debug
const SPAN_RECONNECT = 24 * 60 * 60 * 1000; // 24hour
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

let isProcessing = false;
let wordData = [];
let hourCnt = 0;
let ws;

// WebSocketの再接続関数
function reconnectWebSocket() {
  console.log('Reconnecting WebSocket...');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(); // 接続が開いている場合のみ強制終了
  } else {
    startWebSocket();
  }
}

// WebSocket接続の開始関数
function startWebSocket() {
  ws = new WebSocket(JETSTREAM_URL);

  ws.on('open', () => {
    console.log('WebSocket connected');
  });

  ws.on('message', async (data) => {
    if (isProcessing) {
      console.log("skip message for processing")
      return;
    }

    isProcessing = true;

    try {
      const message = JSON.parse(data);

      if (message.commit?.record?.langs?.includes('ja')) {
        const text = message.commit.record.text;

        console.log(text);

        const createdAt = message.commit.record.createdAt;
        const nouns = await getNouns(text);
        nouns.forEach(noun => saveWordData(noun, createdAt));
      }
    } catch (error) {
      console.error('Error processing message:', error);
    } finally {
      isProcessing = false;
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    setTimeout(reconnectWebSocket, 5000); // 5秒後に再接続
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed, reconnecting...');
    setTimeout(reconnectWebSocket, 1000); // 1秒後に再接続
  });

  ws.on('ping', () => {
    ws.pong();
    console.log('Received ping, sent pong');
  });
}

// 24時間ごとにWebSocket再接続処理
setInterval(() => {
  console.log('24 hours passed, reconnecting WebSocket');
  reconnectWebSocket();
}, SPAN_RECONNECT);

// 過去24時間の単語データを保存する関数
function saveWordData(noun, timestamp) {
  wordData.push({ noun, timestamp: new Date(timestamp) });
  const cutoffTime = Date.now() - 2 * 60 * 60 * 1000;
  wordData = wordData.filter(data => new Date(data.timestamp).getTime() >= cutoffTime);
}

// 1時間おきに実行する定期処理
setInterval(async () => {
  const wordEma = {};
  console.log('Hourly analysis started');

  const { data, error } = await supabase.from('statistics')
    .select('data->trendsToday')
    .eq('id', 'trend');
  const wordDataPast = data[0].trendsToday;

  const wordDataAll = {};
  wordDataPast.forEach(({ noun, count }) => {
    count.unshift(0);
    count.pop();
    wordDataAll[noun] = count;
  });

  const currentTime = Date.now();
  wordData.forEach(({ noun, timestamp }) => {
    const hoursAgo = Math.floor((currentTime - new Date(timestamp).getTime()) / SPAN_CALC_EMA);
    if (hoursAgo < 24) {
      if (wordDataAll[noun]) {
        wordDataAll[noun][hoursAgo] += 1;
      } else {
        wordDataAll[noun] = Array(24).fill(0);
        wordDataAll[noun][hoursAgo] += 1;
      }
    }
  });
  wordData.length = 0;

  Object.keys(wordDataAll).forEach(noun => {
    wordEma[noun] = calculateEMA(wordDataAll[noun], hourCnt + 1);
  });

  const sortedWords = Object.entries(wordEma)
    .sort((a, b) => b[1][0] - a[1][0])
    .map(([noun, ema]) => ({ noun, count: ema }));

  const wordSum = sortedWords.map(({ noun, count }) => ({
    noun,
    count: wordDataAll[noun],
  }));

  await supabase.from('statistics').update({
    data: {
      trendsEma: sortedWords.slice(0, 100),
      trendsToday: wordSum.slice(0, 500),
    },
    updated_at: new Date(),
  })
  .eq('id', 'trend');

  hourCnt = (hourCnt + 1) % 24; // 24時間ごとにリセット
}, SPAN_CALC_EMA);

// WebSocket接続を開始
startWebSocket();
