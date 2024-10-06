import dotenv from 'dotenv';
dotenv.config();
import { Blueskyer } from 'blueskyer'
const agent = new Blueskyer();
import { supabase, getAllRows } from '../lib/supabase.js'
import { calculateEMA } from './average.js';

const EMA_RANGE = 12; // 指数移動平均のレンジ
const DEFAULT_PROFILE = (handle) => {
  return {
    handle: handle,
    displayName: "",
    description: "",
    avatar: '/img/defaultavator.png',
    banner: '/img/defaultavator.png',
    followersCount: 'unknown',
    followersCount: 'unknown',
  }
}

(async() => {
  let data, error;

  // ---------------
  // Trends
  const trendsCurrentRaw = {};
  const trendsIncRateRaw = {};
  const trendsEmaRaw = {};

  // trends、rankingまとめて取得
  data = await getAllRows({tableName: 'records', selectCol: 'handle, result_analyze->wordFreqMap, result_analyze->averageInterval, result_analyze->averagePostsInterval, result_analyze->lastActionTime, profile'});

  console.log(`trends and ranking: got wordFreqMap: ${data.length}`);

  // 各レコードデータに対して、
  // result_analyze.wordFreqFullMapがあれば、それをマージしていく
  // マージ処理
  const now = new Date(); // 現在時刻
  const quarterDay = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6時間前
  const halfDay = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12時間前
  const today = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24時間前
  const yesterday = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48時間前
  const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1週間前

  data.forEach(row => {
    row.wordFreqMap.forEach(word => {
      const occurrences = word.occurrences;
  
      // 24時間分の1時間ごとの頻出数を保持する配列
      let hourlyCounts = Array(24).fill(0);
      let count24h = 0;  // 24時間内の単語の頻出回数
      let count48h_24h = 0; // 48~24時間内の単語の頻出回数
    
      // 各出現時間を1時間ごとに集計
      occurrences.forEach(occurrence => {
        const occurrenceTime = new Date(occurrence.timestamp);
        const hoursAgo = Math.floor((now - occurrenceTime) / (1000 * 60 * 60));
        
        if (hoursAgo >= 0 && hoursAgo < 24) {
          hourlyCounts[hoursAgo]++;
          count24h++; // 24時間内の出現回数
        } else if (hoursAgo >= 24 && hoursAgo < 48) {
          count48h_24h++; // 48~24時間内の出現回数
        }
      });
  
      // 指数移動平均を計算（最新のデータに大きな係数）
      const ema = calculateEMA(hourlyCounts, EMA_RANGE);
  
      // 24時間の単語出現数合計を格納
      if (!trendsCurrentRaw[word.noun]) {
        trendsCurrentRaw[word.noun] = 0;
      }
      trendsCurrentRaw[word.noun] = count24h;

      // 48~24時間と24時間の出現数を基に増加率を計算
      if (!trendsIncRateRaw[word.noun]) {
        trendsIncRateRaw[word.noun] = 0;
      }
      if (count48h_24h > 0) {
        trendsIncRateRaw[word.noun] = count24h / count48h_24h; // 48~24時間内の単語に対する増加率
      } else {
        trendsIncRateRaw[word.noun] = count24h > 0 ? count24h / 0.5 : 0; // 安全な値のために0.5で割る
      }

      // trendsEma にEMAを格納
      if (!trendsEmaRaw[word.noun]) {
        trendsEmaRaw[word.noun] = [];
      }
      trendsEmaRaw[word.noun] = ema;


    });
  });
  
  // trendsTodayを出力して直近1時間のEMAでソート
  const trendsToday = Object.keys(trendsCurrentRaw)
    .map(noun => ({ noun, count: trendsCurrentRaw[noun] }))
    .sort((a, b) => b.count - a.count);

  // trendsTodayを出力して直近1時間のEMAでソート
  const trendsIncRate = Object.keys(trendsIncRateRaw)
    .map(noun => ({ noun, count: trendsIncRateRaw[noun] }))
    .sort((a, b) => b.count - a.count);

  // trendsTodayを出力して直近1時間のEMAでソート
  const trendsEma = Object.keys(trendsEmaRaw)
    .map(noun => ({ noun, count: trendsEmaRaw[noun] }))
    .sort((a, b) => b.count[0] - a.count[0]);
  
  console.log(`trends: complete to analyze`);

  // DB格納
  ({error} = await supabase
    .from('statistics')
    .update({
      data: {
        trendsToday: trendsToday.slice(0, 100),
        trendsIncRate: trendsIncRate.slice(0, 100),
        trendsEma: trendsEma.slice(0, 100),
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
  // ぶる廃ランキング
  // blueskyログイン
  await agent.login({
    identifier: process.env.BSKY_IDENTIFIER,
    password: process.env.BSKY_APP_PASSWORD,
  });
  console.log(`successful to log in Bluesky`);

  let rankingAddict = data
    .filter(row => row.averageInterval && row.averageInterval !== 0 && new Date(row.lastActionTime) > today)
    .map(row => ({
      handle: row.handle,
      name: row.profile?.displayName || 'Unknown',
      img: row.profile?.avatar || '/img/defaultavator.png',
      profile: row.profile || null,
      wordFreqMap: row.wordFreqMap.slice(0, 3) || null,
      averageInterval: row.averageInterval,
      score: row.averageInterval
    }));
  rankingAddict = rankingAddict.sort((a, b) => a.score - b.score).slice(0, 100);
  for (const rank of rankingAddict) {
    rank.media = await getLatestMedia(rank.handle);
  }
  console.log(`ranking: complete process addict`);

  // 単純インフルエンサーランキング
  let rankingInfluencer = data
    .filter(row => row.profile && row.profile.followersCount > 0 && row.profile.followsCount > 0)
    .map(row => {
      const followersCount = row.profile.followersCount;
      const followsCount = row.profile.followsCount;
      
      // (followersCount / followsCount) * followersCount を計算
      const pointRaw = Math.round((followersCount / followsCount) * followersCount);

      return {
        handle: row.handle,
        name: row.profile?.displayName || 'Unknown',
        img: row.profile?.avatar || '/img/defaultavator.png',
        profile: row.profile || null,
        wordFreqMap: row.wordFreqMap.slice(0, 3) || null,
        averageInterval: row.averageInterval,
        score: pointRaw
      };
    });
  rankingInfluencer = rankingInfluencer.sort((a, b) => b.score - a.score).slice(0, 100);  // 降順ソート
  for (const rank of rankingInfluencer) {
    rank.media = await getLatestMedia(rank.handle);
  }
  console.log(`ranking: complete process influencer`);

  // アクティブインフルエンサーランキング
  let rankingActiveInfluencer = data
    .filter(row => row.profile && row.profile.followersCount > 0 && row.profile.followsCount > 0 && new Date(row.lastActionTime) > thisWeek)
    .map(row => {
      const followersCount = row.profile.followersCount;
      const followsCount = row.profile.followsCount;
      
      // (followersCount / followsCount) * followersCount を計算
      const pointRaw = (followersCount / followsCount) * followersCount;
      const point = pointRaw * 1 / (row.averagePostsInterval > 0 ? row.averagePostsInterval : 1);

      return {
        handle: row.handle,
        name: row.profile?.displayName || 'Unknown',
        img: row.profile?.avatar || '/img/defaultavator.png',
        profile: row.profile || null,
        wordFreqMap: row.wordFreqMap.slice(0, 3) || null,
        averageInterval: row.averageInterval,
        score: point
      };
    })
  rankingActiveInfluencer = rankingActiveInfluencer.sort((a, b) => b.score - a.score).slice(0, 100);  // 降順ソート
  for (const rank of rankingActiveInfluencer) {
    rank.media = await getLatestMedia(rank.handle);
  }
  console.log(`ranking: complete process active influencer`);

  // ---------------
  // DB格納
  // トレンドランキング
  try {
    ({error} = await supabase
      .from('statistics')
      .update({
        data: {
          rankingAddict: rankingAddict,
          rankingInfluencer: rankingInfluencer,
          rankingActiveInfluencer: rankingActiveInfluencer,
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

async function getLatestMedia(handle) {
  const medias = [];

  // await agent.createOrRefleshSession({
  //   identifier: process.env.BSKY_IDENTIFIER,
  //   password: process.env.BSKY_APP_PASSWORD,
  // });

  const {data} = await agent.getAuthorFeed({actor: handle, limit: 100, filter: 'posts_with_media'}).catch(e => {
    console.error(e);
    console.warn(`[WARN] fetch error handle: ${handle}, so set empty object`);
    return { data: {feed: []} };
  });
  // console.log(data);
  data.feed.forEach(feed => {
    const images = feed.post.embed.images;
    if (images) {
      images.forEach(image => {
        medias.push(image);
      })
    }
  })

  if (medias.length > 0){
    return medias[0];
  } else {
    return medias;
  }
}
