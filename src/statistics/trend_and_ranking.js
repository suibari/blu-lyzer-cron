import dotenv from 'dotenv';
dotenv.config();
import { supabase, getAllRows } from '../lib/supabase.js'

(async() => {
  let data, error;

  // ---------------
  // Trends
  const trendsCurrentRaw = {};
  const trendsPreviousRaw = {};
  const trendsIncRateRaw = {};

  // trends、rankingまとめて取得
  data = await getAllRows({tableName: 'records', selectCol: 'handle, result_analyze->wordFreqMap, result_analyze->averageInterval, result_analyze->lastActionTime, profile'});

  console.log(`trends and ranking: got wordFreqMap: ${data.length}`);

  // 各レコードデータに対して、
  // result_analyze.wordFreqFullMapがあれば、それをマージしていく
  // マージ処理
  const now = new Date(); // 現在時刻
  const quarterDay = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6時間前
  const halfDay = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12時間前
  const today = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24時間前
  const yesterday = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48時間前

  data.forEach(row => {
    row.wordFreqMap.forEach(word => {
      const refDate = halfDay;
      const tgtDate = today;
      const occurrences = word.occurrences;
  
      let countRef = 0;
      occurrences.forEach(occurrence => {
        const occurrenceTime = new Date(occurrence.timestamp);
        if (occurrenceTime >= refDate && occurrenceTime <= now) {
          countRef++;
        }
      });
      // countRef = countRef + word.sentimentScore;
  
      let countTgt = 0;
      occurrences.forEach(occurrence => {
        const occurrenceTime = new Date(occurrence.timestamp);
        if (occurrenceTime >= tgtDate && occurrenceTime < refDate) {
          countTgt++;
        }
      });
      // countTgt = countTgt + word.sentimentScore;
  
      // 現在のトレンド集計
      if (trendsCurrentRaw[word.noun]) {
        trendsCurrentRaw[word.noun] += countRef;
      } else {
        trendsCurrentRaw[word.noun] = countRef;
      }

      // 過去のトレンド集計
      if (trendsPreviousRaw[word.noun]) {
        trendsPreviousRaw[word.noun] += countTgt;
      } else {
        trendsPreviousRaw[word.noun] = countTgt;
      }
    });
  });

  // 昨日から今日にかけての増加率集計
  for (const word in trendsCurrentRaw) {
    if (trendsPreviousRaw.hasOwnProperty(word) && trendsPreviousRaw[word] !== 0) {
      trendsIncRateRaw[word] = trendsCurrentRaw[word] / trendsPreviousRaw[word];
    } else {
      trendsIncRateRaw[word] = trendsCurrentRaw[word] / 0.5 ;
    }
  }
  
  // trendsTodayとtrendsIncRateを配列に変換してソート
  const trendsToday = Object.keys(trendsCurrentRaw)
    .map(noun => ({ noun, count: trendsCurrentRaw[noun] }))
    .sort((a, b) => b.count - a.count);
  
  const trendsIncRate = Object.keys(trendsIncRateRaw)
    .map(noun => ({ noun, count: trendsIncRateRaw[noun] }))
    .sort((a, b) => b.count - a.count);

  console.log(`trends: complete to analyze`);

  // DB格納
  ({error} = await supabase
    .from('statistics')
    .update({
      data: {
        trendsToday: trendsToday.slice(0, 100),
        trendsIncRate: trendsIncRate.slice(0, 100),
      },
      updated_at: new Date(),
    })
    .eq('id', 'trend')
    .select());
  if (error) { 
    console.error(error);
    throw error;
  }
  console.log(`trends: complete upsert`);

  // ---------------
  // Ranking
  
  // デストラクチャリングで `averageInterval` を直接取得
  const rankingAddict = data
    .filter(row => row.averageInterval && row.averageInterval !== 0 && new Date(row.lastActionTime) > today)
    .map(row => ({
      handle: row.handle,
      name: row.profile.displayName || 'Unknown',
      img: row.profile.avatar || '/img/defaultavator.png',
      wordFreqMap: row.wordFreqMap || null,
      score: row.averageInterval
    }))
    .sort((a, b) => a.score - b.score);

  const rankingInfluencer = data
    .filter(row => row.profile && row.profile.followersCount > 0 && row.profile.followsCount > 0)
    .map(row => {
      const followersCount = row.profile.followersCount;
      const followsCount = row.profile.followsCount;
      // (followersCount / followsCount) * followersCount を計算
      const score = Math.round((followersCount / followsCount) * followersCount);
      return {
        handle: row.handle,
        name: row.profile.displayName,
        img: row.profile.avatar || '/img/defaultavator.png',
        wordFreqMap: row.wordFreqMap || null,
        score: score
      };
    })
    .sort((a, b) => b.score - a.score);  // 降順ソート
  
  // DB格納
  
  try {
    ({error} = await supabase
      .from('statistics')
      .update({
        data: {
          rankingAddict: rankingAddict.slice(0, 100),
          rankingInfluencer: rankingInfluencer.slice(0, 100),
        },
        updated_at: new Date(),
      })
      .eq('id', 'ranking')
      .select());
    if (error) { 
      console.error(error);
      throw error;
    }
    console.log(`ranking: complete upsert`);
  } catch (e) {
    console.error(e);
  }
})();