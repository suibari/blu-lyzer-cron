import { WebSocket } from 'ws';
import { supabase } from '../lib/supabase.js';
import { getNouns } from '../wordfreq.js';
import { calculateEMA } from '../statistics/average.js';

const SPAN_CALC_EMA = 60 * 60 * 1000; // 1hour
// const SPAN_CALC_EMA = 60 * 1000; // 1min: debug

const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

let isProcessing = false;
let wordData = [];
let hourCnt = 0;

// 過去24時間の単語データを保存する関数
function saveWordData(noun, timestamp) {
  wordData.push({ noun, timestamp: new Date(timestamp) });
  // 24時間前のデータを削除
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
  wordData = wordData.filter(data => new Date(data.timestamp).getTime() >= cutoffTime);
}

// WebSocket接続
let ws = new WebSocket(JETSTREAM_URL);

// WebSocket接続時
ws.on('open', () => {
  console.log('WebSocket connected');
});

// メッセージ受信時
ws.on('message', async (data) => {
  if (isProcessing) {
    console.log('Processing is still in progress, skipping message.');
    return;
  }
  
  isProcessing = true;
  
  try {
    const message = JSON.parse(data);

    // commit.record.langs[]に"ja"が含まれるか確認
    if (message.commit && message.commit.record && message.commit.record.langs && message.commit.record.langs.includes('ja')) {
      const text = message.commit.record.text;
      const createdAt = message.commit.record.createdAt;

      console.log(text);

      // 形態素解析して名詞を抽出
      const nouns = await getNouns(text);
      nouns.forEach(noun => {
        try {
          saveWordData(noun, createdAt);
        } catch (error) {
          console.error('Error saving word data:', error);
        }
      });
    }
  } catch (error) {
    console.error('Error processing message:', error);
  } finally {
    isProcessing = false;
  }
});

// エラー時
ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('WebSocket connection closed, attempting to reconnect');
  setTimeout(() => {
    // WebSocket再接続処理を実装
    ws = new WebSocket(JETSTREAM_URL);
  }, 1000); // 1秒後に再接続を試みる
});

ws.on('ping', () => {
  ws.pong();
  console.log('Received ping, sent pong');
});

// 1時間おきに実行する定期処理
setInterval(async () => {
  const wordEma = {};
  console.log('Hourly analysis started');

  // 1時間ごとの単語カウント
  const wordCount = {};
  const currentTime = Date.now();

  wordData.forEach(({ noun, timestamp }) => {
    const hoursAgo = Math.floor((currentTime - new Date(timestamp).getTime()) / SPAN_CALC_EMA);
    if (hoursAgo < 24) {
      if (wordCount[noun]) {
        wordCount[noun][hoursAgo] += 1;
      } else {
        wordCount[noun] = Array(24).fill(0);
        wordCount[noun][hoursAgo] += 1;
      }
    }
  });

  // 2つたまったらEMA計算
  if (hourCnt > 0) {
    // 各時間帯の単語カウントの指数移動平均(EMA)を計算
    Object.keys(wordCount).forEach(noun => {
      wordEma[noun] = calculateEMA(wordCount[noun], hourCnt + 1);
    });

    // 直近のEMA[0]を基準に降順ソート
    const sortedWords = Object.entries(wordEma)
      .sort((a, b) => b[1][0] - a[1][0])
      .map(([noun, ema]) => ({ noun, count: ema }));

    // 単純合計を算出
    const wordSum = [];
    sortedWords.forEach(({noun, count}) => {
      wordSum.push({noun, count : wordCount[noun]})
    });

    // ソート結果をデータベースに保存（仮の例としてコンソール出力）
    const {data, error} = await supabase.from('statistics').update({
      data: {
        trendsEma: sortedWords.slice(0, 100),
        trendsToday: wordSum.slice(0, 100), // いつか消す
        trendsIncRate: sortedWords.slice(0, 100), // いつか消す
      },
      updated_at: new Date(),
    })
    .eq('id', 'trend')
    .select();

    if (error) {
      console.error(error);
    } else {
      console.log('Complete update DB by EMA');
    }
  } else {
    console.log('Skip calc EMA for first process');
  }

  // hourCntをインクリメント、ただし23が上限
  if (hourCnt < 24) {
    hourCnt++;
  }
}, SPAN_CALC_EMA); // 1時間おき
