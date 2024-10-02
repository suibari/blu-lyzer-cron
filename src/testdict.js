import dotenv from 'dotenv';
import { Blueskyer } from 'blueskyer'
import { getNounFrequencies } from './wordfreq.js';
dotenv.config();
const agent = new Blueskyer();

const SUPABASE_PAGE_SIZE = 1000;
const BULK_RANDOM_SIZE = 3000;
const CHUNK_SIZE = 100; // 500だとsupabaseのtimeoutが発生する

(async() => {

  // ---------------------
  // blueskyログイン
  await agent.login({
    identifier: process.env.BSKY_IDENTIFIER,
    password: process.env.BSKY_APP_PASSWORD,
  });
  console.log(`successful to log in Bluesky`);
  
  // ポスト100件取得
  const records = {};
  const response = await agent.listRecords({repo: "suibari-cha.bsky.social", collection: "app.bsky.feed.post", limit: 100}).catch(e => {
    console.error(e);
    console.warn(`[WARN] fetch error handle: ${handle}, so set empty object`);
    return { records: [] };
  });
  records.posts = response.records || [];

  const { wordFreqMap, sentimentHeatmap}  = await getNounFrequencies(records.posts);
  for (const word of wordFreqMap) {
    console.log(word.noun);
  }

})();
