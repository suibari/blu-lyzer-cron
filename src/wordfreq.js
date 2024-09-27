import { PUBLIC_NODE_ENV } from '$env/static/public' 
import fs from 'fs';
import kuromoji from 'kuromoji';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';

const EXCLUDE_WORDS = [
  "こと", "これ", "それ", "そう", "どこ", 
  "さん", "ちゃん", "くん", "自分", "おれ", "やつ", 
  "よう", "みたい", 
  "はず", 
  "今日", "明日", "本日", "あした", "きょう",
  "ここ", "ところ",
  "www", "com", "https", 
  "あなた", "彼", "彼女", "俺", "僕", "私", "私達", "私たち", "あなたたち", "彼ら", "誰", "何", "何か", "どれ", "どちら", // 人称代名詞
  "今", "昨日", "昨日", "明後日", "先日", "先週", "来週", "今年", "去年", "日", "年", "月", "時間", "時", "分", "秒", "いつ", "前", "後", "前日", "毎日", "毎年", "毎月", "昨日", "先ほど", "そこ", // 時間場所
  "もの", "事", "事柄", "場合", "人", "方", "人々", "方々", "者", "方", "事", "所", "物", "部分", "箇所", // 一般的な言葉
  "全て", "すべて", "みんな", "全部", "他", "他人", "誰か",
  "ところ", "くらい", "ぐらい", "けど", "けれども", "ただ", "ため", "どう", "何故", "なぜ", "どんな", "どの", "だれ", "これ", "それ", "あれ", "ここ", "そこ", "あそこ",
  "http", "www", "html", "php", "net", "org", "ftp", "co", "io", "jp", "www", "mailto", // インターネット
  "bsky", "social", // Bluesky
  "to", "the", "of", "you", "be", "in", "is", "it", "for", "that", "on" // 英語
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kuromoji tokenizerのビルダー
const dicPath = (PUBLIC_NODE_ENV === 'development') ?
  "node_modules/kuromoji/dict" : 
  resolve(__dirname, '/../../../../node_modules/kuromoji/dict') ; // to: server-root/.svelte-kit/output/server/submodule/dict
const tokenizerBuilder = kuromoji.builder({ dicPath: dicPath });

// 感情辞書ファイルパス
const POLARITY_DICT_PATH = (PUBLIC_NODE_ENV === 'development') ?
  'src/lib/server/submodule/dict/pn.csv.m3.120408.trim' :
  resolve(__dirname, '../../../../src/lib/server/submodule/dict/pn.csv.m3.120408.trim'); // to: server-root/.svelte-kit/output/server/submodule/dict
const polarityMap = await loadPolarityDictionary(); // 感情辞書をロード

/**
 * テキストの配列から名詞の頻出TOP3を返す関数
 */
export async function getNounFrequencies(posts) {
  return new Promise((resolve, reject) => {
    tokenizerBuilder.build((err, tokenizer) => {
      if (err) {
        return reject(err);
      }

      const freqMap = {};
      const sentimentHeatmap = new Array(24).fill(0) // 24時間ヒートマップを初期化

      posts.forEach(post => {
        let text = post.value.text;

        // textがnull, undefined, 空文字でないことを確認
        if (typeof text !== 'string' || text.trim() === '') {
          return; // 空の場合は処理をスキップ
        }

        // ヌル文字を空文字に置換
        text = text.replace(/\0/g, '');

        // 日本語ポストであることを確認
        if (post.value.langs && post.value.langs.includes("ja")) {   
        
          try {
            const tokens = tokenizer.tokenize(text);
            const nouns = tokens.filter(token => 
              token.pos === '名詞' &&
              !/^[\d]+$/.test(token.surface_form) && // 数値の除外
              !/^[^\p{L}]+$/u.test(token.surface_form) && // 記号の除外
              !/^[ぁ-ん]{1}$/.test(token.surface_form) && // ひらがな一文字の除外
              token.surface_form.length !== 1 && // 1文字のみの単語を除外
              !/ー{2,}/.test(token.surface_form) && // 伸ばし棒2文字以上の単語を除外
              !EXCLUDE_WORDS.includes(token.surface_form) // EXCLUDE_WORDSに含まれていない
            );

            const createdAt = new Date(post.value.createdAt);
            const utcDate = new Date(createdAt.getTime());
            const jstDate = new Date(utcDate.getTime() + 9*60*60*1000); // JSTに変換
            const hourKey = jstDate.getUTCHours(); // JSTの時間を取得

            nouns.forEach(noun => {
              
              const surfaceForm = noun.surface_form;
              const sentimentScore = polarityMap[surfaceForm] || 0;

              if (!freqMap[surfaceForm]) {
                freqMap[surfaceForm] = {
                  count: 0,
                  firstSeen: createdAt,
                  lastSeen: createdAt,
                  sentimentScoreSum: 0, // 感情スコア合計
                  occurrences: [],
                };
              }
              freqMap[surfaceForm].count++;
              freqMap[surfaceForm].lastSeen = createdAt;
              freqMap[surfaceForm].sentimentScoreSum += sentimentScore; // 感情スコアを加算
              sentimentHeatmap[hourKey] += sentimentScore;

              // occurrencesにポストIDと日時を追加
              freqMap[surfaceForm].occurrences.push({
                timestamp: createdAt,
                postId: post.uri,
              });
            });

          } catch (err) {
            console.warn(`[WARN] word analyze error occur`);
            console.warn(err);
          }
          
        } else {
          // 日本語でないポストの場合、現状何もしない
          return;
        }
      });      

      const wordFreqMap = Object.entries(freqMap)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([noun, data]) => ({
          noun,
          count: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          sentimentScore: data.sentimentScoreSum,
          occurrences: data.occurrences,
        }));

      resolve({ wordFreqMap, sentimentHeatmap });
    });
  });
}

/**
 * 感情辞書を読み込み、単語とスコアのマップを作成
 * @returns {Promise<Object>} 単語と感情スコアのマップ
 */
async function loadPolarityDictionary() {
  const polarityMap = {};

  return new Promise((resolve, reject) => {
    fs.readFile(POLARITY_DICT_PATH, 'utf8', (err, data) => {
      if (err) {
        return reject(err);
      }

      const lines = data.split('\n');
      lines.forEach(line => {
        const [word, score] = line.split('\t'); // タブ区切りで単語と感情値を取得
        if (word && score) {
          // ポジティブ => +1、ネガティブ => -1、中立 => 0
          polarityMap[word] = score === 'p' ? 1 : score === 'n' ? -1 : 0;
        }
      });

      resolve(polarityMap);
    });
  });
}
