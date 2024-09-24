import dotenv from 'dotenv';
import { Blueskyer } from 'blueskyer'
import { createClient } from '@supabase/supabase-js'
import { analyzeRecords } from './analyze.js';
dotenv.config();
const agent = new Blueskyer();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SUPABASE_PAGE_SIZE = 1000;
// const BULK_RANDOM_SIZE = 1000; // この行のコメントアウトで全レコード取得
const CHUNK_SIZE = 100; // 500だとsupabaseのtimeoutが発生する

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

    // ランダムにrowを選ぶ
    let handles = [];
    if (BULK_RANDOM_SIZE) {
      const shuffledData = shuffle([...data]);  // 元の配列を破壊しないようにコピーしてシャッフル
      const selectedData = shuffledData.slice(0, BULK_RANDOM_SIZE);
      handles = selectedData.map(row => row.handle);
    } else {
      handles = data.map(row => row.handle);
    }

    // ---------------------
    // 全員分getProfilesする (1回目しかいらない)
    const profiles = await agent.getConcatProfiles(handles);
    console.log(`successful to get all profiles: ${profiles.length}`);

    // ---------------------
    // handleごとにgetListRecordsする
    let response;
    let i = 0;
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
        result_analyze: analyze,
      });
      console.log(`successful to analyze: ${handle}, ${i}/${handles.length}`);
      i++;
    };

    // ---------------------
    // データ整形
    // profileがbulkDataにある場合セット、なければnullセット
    const profileMap = Object.fromEntries(profiles.map(p => [p.handle, p]));
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
    const bulkChunks = chunkArray(bulkData, CHUNK_SIZE);
    for (const chunk of bulkChunks) {
      const result = await supabase.from('records').upsert(chunk).select();
      if (result.error) {
        console.log(result.error);
      } else {
        console.log(`finish upsert: ${chunk.length}`);
      }
    }
    
  } catch (error) {
    console.error(`Error:`, error);
  }
})();

// シャッフル関数 (Fisher-Yatesアルゴリズム)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// チャンク分割の関数
function chunkArray(array, size) {
  const chunkedArr = [];
  for (let i = 0; i < array.length; i += size) {
    chunkedArr.push(array.slice(i, i + size));
  }
  return chunkedArr;
}
