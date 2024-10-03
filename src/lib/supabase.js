import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function getAllRows(params) {
  let from = 0;
  const limit = 1000;
  let allRecords = [];
  let hasMore = true;
  const maxRetries = 3; // 最大試行回数
  let retryCount = 0;

  while (hasMore) {
    try {
      const { data, error } = await supabase
        .from(params.tableName)
        .select(params.selectCol)
        .range(from, from + limit - 1);

      if (error) {
        throw error; // エラーが発生した場合、例外をスロー
      }

      console.log(`got records: ${data.length}`);
      allRecords = [...allRecords, ...data];

      // データがlimit未満の場合は、すべてのデータを取得したと判断
      if (data.length < limit) {
        hasMore = false;
      } else {
        from += limit;
      }

      // 正常に取得できたらリトライカウントをリセット
      retryCount = 0;

    } catch (error) {
      console.warn(`Error fetching data: ${error.message}`);

      // エラーが発生した場合、再試行する
      if (retryCount < maxRetries) {
        retryCount++;
        console.log(`Retrying... (${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // 再試行前に少し待機
      } else {
        console.error("Max retry attempts reached. Exiting.");
        break; // 最大試行回数に達したらループを抜ける
      }
    }
  }

  return allRecords;
}
