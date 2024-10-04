/**
 * 指数移動平均の計算関数
 * dataは[0h, 1h, ..., 23h]
 * periodで時間範囲を指定
 * 得られた要素の0番目をソートする
 */
export function calculateEMA(data, period) {
  const smoothing = 2 / (period + 1);
  let ema = [];
  let prevEma = data[data.length - 1]; // 初期値は最後のデータ
  ema[data.length - 1] = prevEma;

  // データを逆順で処理
  for (let i = data.length - 2; i >= 0; i--) {
    const currentEma = (data[i] - prevEma) * smoothing + prevEma;
    ema[i] = currentEma;
    prevEma = currentEma;
  }

  return ema;
}
