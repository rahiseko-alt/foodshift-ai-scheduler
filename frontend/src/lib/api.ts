import { ShiftOptimizeRequest, ShiftOptimizeResponse } from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://foodshift-api.onrender.com';

export async function requestShiftOptimization(
  data: ShiftOptimizeRequest,
  onColdStartWarning?: () => void
): Promise<ShiftOptimizeResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒タイムアウト

  // 5秒経過時にコールドスタート警告コールバックを実行
  const warningTimer = setTimeout(() => {
    if (onColdStartWarning) {
      onColdStartWarning();
    }
  }, 5000);

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    clearTimeout(warningTimer);
    clearTimeout(timeoutId);

    if (response.status === 413) {
      throw new Error('データサイズが大きすぎます (1MB上限)');
    }

    if (response.status === 429) {
      throw new Error('リクエスト回数制限を超過しました。1分後に再試行してください');
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(
        errBody.detail || `サーバーエラーが発生しました (${response.status})`
      );
    }

    const result: ShiftOptimizeResponse = await response.json();
    return result;
  } catch (err: unknown) {
    clearTimeout(warningTimer);
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'サーバーからの応答がタイムアウトしました。サーバーの起動中である可能性があります。もう一度お試しください。'
      );
    }
    throw err;
  }
}
