import { WebSocket } from 'ws';
import { getNouns } from '../wordfreq.js';
import { calculateEMA } from '../statistics/average.js';

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
const ws = new WebSocket('wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.feed.post');

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

// 1時間おきに実行する定期処理
setInterval(() => {
    console.log('Hourly analysis started');

    // 1時間ごとの単語カウント
    const wordCount = Array(24).fill(0).map(() => ({}));
    const currentTime = Date.now();

    wordData.forEach(({ noun, timestamp }) => {
        const hoursAgo = Math.floor((currentTime - new Date(timestamp).getTime()) / (60 * 60 * 1000));
        if (hoursAgo < 24) {
            wordCount[noun][hoursAgo] = (wordCount[noun][hoursAgo] || 0) + 1;
        }
    });

    // 各時間帯の単語カウントの指数移動平均(EMA)を計算
    const emaData = calculateEMA(wordCount, hourCnt+1);

    // 直近のEMAを基準に降順ソート
    const sortedWords = Object.entries(emaData[0])
        .sort((a, b) => b[1] - a[1]);

    // hourCntをインクリメント、ただし23が上限
    if (hourCnt < 24) {
      hourCnt++;
    }

    // ソート結果をデータベースに保存（仮の例としてコンソール出力）
    console.log('Top words based on recent EMA:', sortedWords);

}, 60 * 60 * 1000); // 1時間おき
