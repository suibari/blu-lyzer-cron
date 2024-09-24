import dotenv from 'dotenv';
import { Blueskyer } from 'blueskyer'
import { createClient } from '@supabase/supabase-js'
import { analyzeRecords } from './analyze.js';
dotenv.config();
const agent = new Blueskyer();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SUPABASE_PAGE_SIZE = 1000;
const BSKY_BATCH_SIZE = 25;

console.log('start batch process');

(async() => {
  const bulkData = [];

  try {
    // ---------------------
    // blueskyログイン
    await agent.login({
      identifier: process.env.BSKY_IDENTIFIER,
      password: process.env.BSKY_APP_PASSWORD,
    });
    console.log(`successful to log in Bluesky`);
    
    // ---------------------
    // データベースをページネーションで取得
    let data = [];
    let from = 0;
    let to = SUPABASE_PAGE_SIZE - 1;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
      const { data: pageData, error } = await supabase
        .from('records')
        .select('handle')
        .range(from, to);  // レコードの範囲を指定

      if (error) {
        console.error("Error fetching data:", error);
        break;
      }

      // データが返ってこない場合は終了
      if (pageData.length === 0) {
        moreDataAvailable = false;
      } else {
        data = data.concat(pageData);
        from += SUPABASE_PAGE_SIZE;
        to += SUPABASE_PAGE_SIZE;
      }
    }
    console.log(`get record of handles: ${data.length}`);

    // ---------------------
    // 全員分getProfilesする (1回目しかいらない)
    const handles = data.map(row => row.handle);
    const profiles = await agent.getConcatProfiles(handles);
    console.log(`successful to get all profiles: ${profiles.length}`);

    // ---------------------
    // handleごとにgetListRecordsする
    let response;
    for (const handle of handles) {
      const records = {};
    
      // ポスト100件取得
      response = await agent.listRecords({repo: handle, collection: "app.bsky.feed.post", limit: 100}).catch(e => {
        console.error(e);
        console.warn(`[WARN] fetch error handle: ${handle}, so set empty object`);
        return { records: [] };
      });
      records.posts = response.records;
      // いいね100件取得
      response = await agent.listRecords({repo: handle, collection: "app.bsky.feed.like", limit: 100}).catch(e => {
        console.error(e);
        console.warn(`[WARN] fetch error handle: ${handle}, so set empty object`);
        return { records: [] };
      });
      records.likes = response.records;

      // 解析
      const analyze = await analyzeRecords(records);
      bulkData.push({
        handle: handle,
        analyze_result: analyze,
      });
      console.log(`successful to analyze: ${handle}`);
    };

    // ---------------------
    // データ整形
    // profileがbulkDataにある場合セット、なければnullセット
    const profileMap = Object.fromEntries(profiles.map(p => [p.handle, p.profile]));
    bulkData.forEach(bulkItem => {
      bulkItem.profile = profileMap[bulkItem.handle] || null;
    });
    bulkData.forEach(bulkItem => {
      bulkItem.updated_at = new Date();
    });
    bulkData.forEach(bulkItem => {
      bulkItem.records = null;
    });

    // ---------------------
    // DB格納
    console.log(bulkData);
    const result = await supabase.from('records').upsert(bulkData).select();
    if (result.data.length > 0){
      console.log(`finish upsert: ${bulkData.length}`)
    }
    
  } catch (error) {
    console.error(`Error:`, error);
  }
})();
