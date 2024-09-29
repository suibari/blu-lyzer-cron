import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function getAllRows(params) {
  let from = 0;
  const limit = 1000;
  let allRecords = [];
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(params.tableName)
      .select(params.selectCol)
      .range(from, from + limit - 1);

    if (error) {
      console.error(error);
      break;
    }
    console.log(`got records: ${data.length}`);

    allRecords = [...allRecords, ...data];

    if (data.length < limit) {
      hasMore = false;
    } else {
      from += limit;
    }
  }

  return allRecords;
}