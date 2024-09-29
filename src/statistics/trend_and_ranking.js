import dotenv from 'dotenv';
dotenv.config();
import { supabase, getAllRows } from '../lib/supabase.js'

(async() => {
  let data, error;

  // ---------------
  // Trends
  const trendsToday = [];
  const trendsIncRate = [];

  // trends、rankingまとめて取得
  data = await getAllRows({tableName: 'records', selectCol: 'handle, result_analyze->wordFreqMap, result_analyze->averageInterval, profile'});

  console.log(`trends and ranking: got wordFreqMap: ${data.length}`);

  // 各レコードデータに対して、
  // result_analyze.wordFreqFullMapがあれば、それをマージしていく
  // マージ処理
  const now = new Date(); // 現在時刻
  const today = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24時間前
  const yesterday = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48時間前

  data.forEach(row => {
    row.wordFreqMap.forEach(word => {
      const occurrences = word.occurrences;

      let countToday = 0;
      occurrences.forEach(occurrence => {
        const occurrenceTime = new Date(occurrence.timestamp);
        if (occurrenceTime >= today && occurrenceTime <= now) {
          countToday++;
        };
      });

      let countYesterday = 0;
      occurrences.forEach(occurrence => {
        const occurrenceTime = new Date(occurrence.timestamp);
        if (occurrenceTime >= yesterday && occurrenceTime < today) {
          countYesterday++;
        };
      });

      // 今日のトレンド
      trendsToday.push({
        noun: word.noun,
        count: countToday,
      });

      // 昨日から今日にかけての増加率
      const incRate = countToday / (countYesterday || 1);
      trendsIncRate.push({
        noun: word.noun,
        count: incRate,
      });
    });
  });
  console.log(`trends: complete to analyze`);

  // できたマージ結果をソート
  trendsToday.sort((a, b) => b.count - a.count);
  trendsIncRate.sort((a, b) => b.count - a.count);

  // DB格納
  ({error} = await supabase
    .from('statistics')
    .upsert({
      id: 'trend',
      data: {
        trendsToday: trendsToday.slice(0, 100),
        trendsIncRate: trendsIncRate.slice(0, 100),
      },
      updated_at: new Date(),
    })
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
    .map(row => ({
      handle: row.handle,
      averageInterval: row.averageInterval
    }))
    .sort((a, b) => a.averageInterval - b.averageInterval);

  const rankingInfluencer = data
    .map(row => {
      if (row.profile) {
        const followersCount = row.profile.followersCount;
        const followsCount = row.profile.followsCount;
        // (followersCount / followsCount) * followersCount を計算
        const metric = (followersCount / followsCount) * followersCount;
        return {
          handle: row.handle,
          metric: metric
        };
      }
    })
    .sort((a, b) => b.metric - a.metric);  // 降順ソート
  
  // DB格納
  ({error} = await supabase
    .from('statistics')
    .upsert({
      id: 'ranking',
      data: {
        rankingAddict: rankingAddict.slice(0, 100),
        rankingInfluencer: rankingInfluencer.slice(0, 100),
      },
      updated_at: new Date(),
    })
    .select());
  if (error) { 
    console.error(error);
    throw error;
  }
  console.log(`ranking: complete upsert`);
})();