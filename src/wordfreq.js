import dotenv from 'dotenv';
import fs from 'fs';
import kuromoji from 'kuromoji';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';
dotenv.config();
const PUBLIC_NODE_ENV = process.env.PUBLIC_NODE_ENV;

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
  "to", "the", "of", "you", "be", "in", "is", "it", "for", "that", "on", // 英語
  "ちんぽ", "ちんちん", // R-18
  "なん", "あと", "うち", "たち", "とき", "感じ", "気持ち", "楽しみ", // 運用してみていらないもの
];

/**
 * テキストの配列から名詞の頻出TOP3を返す関数
 */
export async function getNounFrequencies(posts) {
  const wordFreqMap = [];
  const sentimentHeatmap = new Array(24).fill(0); // 24時間ヒートマップを初期化

  // posts[].value.textを二次元リストに変換
  const textsArray = posts
    .filter(post => {
      // 日本語ポストであるか、空でないテキストかを確認
      return (
        typeof post.value.text === 'string' &&
        post.value.text.trim() !== '' &&
        post.value.langs &&
        post.value.langs.includes("ja")
      );
    })
    .map(post => [post.value.text.replace(/\0/g, '')]); // ヌル文字を空文字に置換し、配列にする

  // textが空なら何もせずに終了
  if (!textsArray || textsArray.length === 0) {
    console.log('[INFO] No valid text to analyze');
    return { wordFreqMap, sentimentHeatmap };
  }

  try {
    // ネガポジフェッチ
    const response = await fetch(process.env.NEGAPOSI_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ texts: textsArray }), // 全てのテキストを一度に送信
    });

    if (response.ok) {
      const { nouns_counts, average_sentiments } = await response.json();

      // const nouns = tokens.filter(token =>
      //   token.part_of_speech === '名詞' &&
      //   !/^[\d]+$/.test(token.token) && // 数値の除外
      //   !/^[^\p{L}]+$/u.test(token.token) && // 記号の除外
      //   !/^[ぁ-ん]{1}$/.test(token.token) && // ひらがな一文字の除外
      //   token.token.length !== 1 && // 1文字のみの単語を除外
      //   !/ー{2,}/.test(token.token) && // 伸ばし棒2文字以上の単語を除外
      //   !EXCLUDE_WORDS.includes(token.token) // EXCLUDE_WORDSに含まれていない
      // );

      nouns_counts.forEach((elem, index) => {
        wordFreqMap.push({
          noun: elem.noun,
          count: elem.count,
          sentimentScoreSum: elem.sentiment_sum,
        });
      });

      const sentimentAccumulator = {};
      average_sentiments.forEach((elem, index) => {
        const createdAt = new Date(posts[index].value.createdAt);
        const utcDate = new Date(createdAt.getTime());
        const jstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000); // JSTに変換
        const hourKey = jstDate.getUTCHours(); // JSTの時間を取得

        // 初期化（存在しない場合のみ）
        if (!sentimentAccumulator[hourKey]) {
          sentimentAccumulator[hourKey] = { sum: 0, count: 0 };
        }

        // 累積値とカウントを更新
        sentimentAccumulator[hourKey].sum += elem;
        sentimentAccumulator[hourKey].count += 1;
      });

      // 各hourKeyの平均値を計算してHeatmapに格納
      Object.keys(sentimentAccumulator).forEach((hourKey) => {
        const { sum, count } = sentimentAccumulator[hourKey];
        sentimentHeatmap[hourKey] = count > 0 ? sum / count : 0; // 平均値を格納
      });

    } else {
      throw new Error('Failed to fetch sentiment from NEGPOSI_API');
    }
  } catch (err) {
    console.warn('[WARN] word analyze error occurred');
    console.warn(err);
  }

  return { wordFreqMap, sentimentHeatmap };
}

/**
 * シングルポスト版 
 */
export async function getNouns(text) {
  return new Promise((resolve, reject) => {
    // tokenizerが既にビルド済みか確認
    if (tokenizer) {
      return processText();
    }

    // タイムアウトを5秒に設定
    const timeout = setTimeout(() => {
      reject(new Error('Tokenizer build timeout'));
    }, 5000);

    tokenizerBuilder.build((err, builtTokenizer) => {
      clearTimeout(timeout); // タイムアウトをクリア

      if (err) {
        return reject(err);
      }

      tokenizer = builtTokenizer; // tokenizerをキャッシュ
      processText(); // テキストの処理を実行
    });

    // テキスト処理を関数化
    function processText() {
      // textがnull, undefined, 空文字でないことを確認
      if (typeof text !== 'string' || text.trim() === '') {
        return resolve([]); // 空の場合は処理をスキップし、空配列を返す
      }

      // ヌル文字を空文字に置換
      text = text.replace(/\0/g, '');

      try {
        const tokens = tokenizer.tokenize(text);
        const nouns = tokens.filter(token => 
          token.pos === '名詞' &&
          (token.pos_detail_1 === '固有名詞' || token.pos_detail_1 === '普通名詞') &&
          !/^[\d]+$/.test(token.surface_form) && // 数値の除外
          !/^[^\p{L}]+$/u.test(token.surface_form) && // 記号の除外
          !/^[ぁ-ん]{1}$/.test(token.surface_form) && // ひらがな一文字の除外
          token.surface_form.length !== 1 && // 1文字のみの単語を除外
          !/ー{2,}/.test(token.surface_form) && // 伸ばし棒2文字以上の単語を除外
          !EXCLUDE_WORDS.includes(token.surface_form) // EXCLUDE_WORDSに含まれていない
        );

        const nounArray = nouns.map(noun => noun.surface_form);
        // console.log(nounArray)
        resolve(nounArray);

      } catch (err) {
        console.warn(`[WARN] word analyze error occurred`);
        console.warn(err);
        reject(err);
      }
    }
  });
}
