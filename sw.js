// Service Workerのバージョン管理
const CACHE_NAME = 'gps-run-v1';

// インストール時にキャッシュする最小限のファイル（オフライン対策）
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/接近音.mp3',
  '/通過音.mp3'
];

// ① サービスワーカーのインストールとキャッシュ処理
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting(); // 新しいSWをすぐにアクティブにする
});

// サービスワーカーのアクティベート処理
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ② メインアプリ（App.jsx）からの命令を受け取るリスナー
// 画面が閉じられても、ここがハブとなってバックグラウンド処理を維持します
let backgroundWatchId = null;

self.addEventListener('message', (event) => {
  const data = event.data;

  if (data.action === 'startTracking') {
    console.log('[SW] バックグラウンドGPS監視を開始します');
    startBackgroundTracking();
  } else if (data.action === 'stopTracking') {
    console.log('[SW] バックグラウンドGPS監視を停止します');
    stopBackgroundTracking();
  }
});

// ③ 【重要】バックグラウンドでの位置情報監視ロジック
// 画面が閉じてもシステムに「位置情報を追跡中」であることを認識させるための処理
function startBackgroundTracking() {
  if (backgroundWatchId) return;

  // Androidの仕様に合わせ、定期的に位置情報をチェックするループを作成
  // (画面消灯時の位置情報取得をより安定させるためのトリガーになります)
  backgroundWatchId = setInterval(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          
          // 取得した現在地データをメインアプリ（App.jsx）に送信する
          // アプリ側が裏で起きていれば、これで通過判定が動きます
          self.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({
                type: 'BACKGROUND_GPS_UPDATE',
                latitude,
                longitude,
                timestamp: Date.now(),
                accuracy
              });
            });
          });
        },
        (error) => {
          console.error('[SW] 位置情報取得エラー:', error);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
  }, 3000); // 3秒ごとに位置情報を要求してスリープを防ぐ
}

function stopBackgroundTracking() {
  if (backgroundWatchId) {
    clearInterval(backgroundWatchId);
    backgroundWatchId = null;
    console.log('[SW] バックグラウンドGPS監視を終了しました');
  }
}

// ネットワークリクエストのキャッシュ返却処理（PWAの基本機能）
self.addEventListener('fetch', (event) => {
  // 基本はネットワーク優先、ダメならキャッシュ
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});