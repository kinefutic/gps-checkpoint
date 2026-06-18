import React, { useState, useEffect, useRef } from 'react';
// 🌟 最新の定義に合わせて db と auth をインポート
import { db, auth } from './firebase';
// 🌟 Firebase Authentication の最新関数をインポート
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
// 🌟 Firebase Firestore の最新関数をインポート
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc 
} from 'firebase/firestore';

import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const A = 6378137.000;
const E2 = 0.00669438002301188;

function getDistanceHubeny(lat1, lng1, lat2, lng2) {
  const radLat1 = lat1 * Math.PI / 180;
  const radLng1 = lng1 * Math.PI / 180;
  const radLat2 = lat2 * Math.PI / 180;
  const radLng2 = lng2 * Math.PI / 180;
  const dy = radLat1 - radLat2;
  const dx = radLng1 - radLng2;
  const my = (radLat1 + radLat2) / 2;
  const sinMy = Math.sin(my);
  const w = Math.sqrt(1.0 - E2 * sinMy * sinMy);
  const m = A * (1.0 - E2) / Math.pow(w, 3);
  const n = A / w;
  return Math.sqrt((dy * m) ** 2 + (dx * n * Math.cos(my)) ** 2);
}

function projectToRouteLocalXY(lat, lng, cbLat, cbLng, headingDegrees) {
  const radLat = lat * Math.PI / 180;
  const baseRadLat = cbLat * Math.PI / 180;
  const dy = radLat - baseRadLat;
  const dx = (lng - cbLng) * Math.PI / 180;
  
  const sinMy = Math.sin(baseRadLat);
  const w = Math.sqrt(1.0 - E2 * sinMy * sinMy);
  const m = A * (1.0 - E2) / Math.pow(w, 3);
  const n = A / w;
  
  const worldX = dx * n * Math.cos(baseRadLat);
  const worldY = dy * m;

  const theta = (90 - headingDegrees) * Math.PI / 180;

  const localX = worldX * Math.cos(theta) + worldY * Math.sin(theta);
  const localY = -worldX * Math.sin(theta) + worldY * Math.cos(theta);

  return { x: localX, y: localY };
}

const formatTime = (ms) => {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msStr = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
  return `${m}:${s.toString().padStart(2, '0')}.${msStr}`;
};

const globalAudioApproach = new Audio('/接近音.mp3');
const globalAudioPass = new Audio('/通過音.mp3');

/**
 * 🌟 進行方向角（heading）に合わせて回転するSVG矢印アイコンを生成する関数
 */
const createArrowIcon = (heading, idx) => {
  const svgHtml = `
    <div style="
      transform: rotate(${heading}deg); 
      width: 40px; 
      height: 40px; 
      display: flex; 
      justify-content: center; 
      align-items: center;
    ">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L4 10H9V22H15V10H20L12 2Z" fill="#1890ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <span style="
        position: absolute; 
        top: 12px; 
        background: #ffffff; 
        color: #1890ff; 
        border: 2px solid #1890ff;
        border-radius: 50%; 
        width: 16px; 
        height: 16px; 
        font-size: 11px; 
        font-weight: bold; 
        display: flex; 
        justify-content: center; 
        align-items: center;
        transform: rotate(${-heading}deg);
      ">${idx + 1}</span>
    </div>
  `;

  return L.divIcon({
    html: svgHtml,
    className: 'custom-arrow-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20]
  });
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [screenMode, setScreenMode] = useState('list');
  const [routes, setRoutes] = useState([]); 
  const [searchQuery, setSearchQuery] = useState(''); 
  
  const [currentRoute, setCurrentRoute] = useState(null);
  const [checkpoints, setCheckpoints] = useState([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [lapTimes, setLapTimes] = useState([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [geoError, setGeoError] = useState(null);

  const [volApproach, setVolApproach] = useState(1.0);
  const [volPass, setVolPass] = useState(1.0);
  const [volSpeech, setVolSpeech] = useState(1.0);

  const [editRouteId, setEditRouteId] = useState(null);
  const [editRouteName, setEditRouteName] = useState('');
  const [editCheckpoints, setEditCheckpoints] = useState([]);

  const startTimeRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const watchIdRef = useRef(null);
  const prevLocationRef = useRef(null);
  const lastActiveCpRef = useRef(null);
  const hasWarnedRef = useRef(false);

  const stateRef = useRef({ checkpoints, targetIndex, elapsedTime, lapTimes });
  useEffect(() => {
    stateRef.current = { checkpoints, targetIndex, elapsedTime, lapTimes };
  }, [checkpoints, targetIndex, elapsedTime, lapTimes]);

  const getLogarithmicVolume = (linearVolume) => Math.pow(linearVolume, 2);

  const fetchUserRoutes = async (currentUser) => {
    if (!currentUser) return;
    try {
      const q = query(collection(db, 'routes'), where('uid', '==', currentUser.uid));
      const querySnapshot = await getDocs(q);
      const routeList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRoutes(routeList);
    } catch (error) {
      console.error("データ取得エラー:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        fetchUserRoutes(currentUser);
      } else {
        setRoutes([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => { setGeoError(null); },
        (error) => { if (error.code === 1) setGeoError("位置情報の利用がブロックされています。"); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: Infinity }
      );
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('Service Worker 登録成功:', reg.scope))
        .catch((err) => console.error('Service Worker 登録失敗:', err));

      const handleServiceWorkerMessage = (event) => {
        if (event.data && event.data.type === 'BACKGROUND_GPS_UPDATE') {
          const { latitude, longitude, timestamp } = event.data;
          setCurrentLocation({ latitude, longitude, timestamp });
        }
      };

      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setAuthError('ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。');
    }
  };

  const handleLogout = async () => {
    if (window.confirm('ログアウトしますか？')) {
      try {
        await signOut(auth);
        setScreenMode('list');
      } catch (error) {
        console.error('ログアウト失敗:', error);
      }
    }
  };

  useEffect(() => {
    if (isTracking) {
      startTimeRef.current = Date.now() - elapsedTime;
      timerIntervalRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTimeRef.current);
      }, 40);
    } else {
      clearInterval(timerIntervalRef.current);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [isTracking]);

  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); 
      const utterance = new SpeechSynthesisUtterance(text);
       utterance.lang = 'ja-JP';
      utterance.volume = getLogarithmicVolume(volSpeech);
      window.speechSynthesis.speak(utterance);
    }
  };

  const playApproachNotification = (cpName) => {
    const speechText = `まもなく、${cpName}を通過。`;
    try {
      globalAudioApproach.currentTime = 0;
      globalAudioApproach.volume = getLogarithmicVolume(volApproach);
      globalAudioApproach.onended = () => { speakText(speechText); };
      globalAudioApproach.play().catch(() => speakText(speechText));
    } catch (e) { speakText(speechText); }
  };

  const recordLap = (cpName, estimatedElapsedTime, isGoal) => {
    const totalElapsedMs = estimatedElapsedTime;
    let lapElapsedMs = totalElapsedMs;
    
    const currentLapTimes = stateRef.current.lapTimes;
    if (currentLapTimes.length > 0) {
      const prevTotal = currentLapTimes.reduce((sum, lap) => sum + lap.rawDuration, 0);
      lapElapsedMs = totalElapsedMs - prevTotal;
    }
    const lapM = Math.floor(lapElapsedMs / 60000);
    const lapS = Math.floor((lapElapsedMs % 60000) / 1000);
    const totalM = Math.floor(totalElapsedMs / 60000);
    const totalS = Math.floor((totalElapsedMs % 60000) / 1000);

    const newLap = { cpName, lapTime: formatTime(lapElapsedMs), totalTime: formatTime(totalElapsedMs), rawDuration: lapElapsedMs };
    setLapTimes(prev => [newLap, ...prev]);

    let speechText = `${cpName}を通過。ラップタイムは、`;
    if (lapM > 0) speechText += `${lapM}分${lapS}秒です。`;
    else speechText += `${lapS}秒です。`;

    if (isGoal) {
      speechText += `。合計タイムは、`;
      if (totalM > 0) speechText += `${totalM}分${totalS}秒です。`;
      else speechText += `${totalS}秒です。`;
      speechText += `お疲れ様でした！`;
    }

    try {
      globalAudioPass.currentTime = 0;
      globalAudioPass.volume = getLogarithmicVolume(volPass);
      globalAudioPass.onended = () => { speakText(speechText); };
      globalAudioPass.play().catch(() => speakText(speechText));
    } catch (e) { speakText(speechText); }
  };

  const testAudio = (type) => {
    if (type === 'approach') {
      globalAudioApproach.currentTime = 0;
      globalAudioApproach.volume = getLogarithmicVolume(volApproach);
      globalAudioApproach.play().catch(() => {});
    } else if (type === 'pass') {
      globalAudioPass.currentTime = 0;
      globalAudioPass.volume = getLogarithmicVolume(volPass);
      globalAudioPass.play().catch(() => {});
    } else if (type === 'speech') {
      speakText("テスト音声です。ラップタイムは、5分30秒です。");
    }
  };

  const startRunningMode = (route) => {
    setCurrentRoute(route);
    setCheckpoints(route.checkpoints || []);
    setTargetIndex(0);
    setElapsedTime(0);
    setLapTimes([]);
    setScreenMode('running');
  };

  const startEditMode = (route = null) => {
    if (route) {
      setEditRouteId(route.id);
      setEditRouteName(route.name || '');
      setEditCheckpoints(route.checkpoints || []);
    } else {
      setEditRouteId(null);
      setEditRouteName('');
      setEditCheckpoints([]);
    }
    setScreenMode('edit');
  };

  function MapClickHandler() {
    useMapEvents({
      click(e) {
        const { lat, lng } = e.latlng;
        const newCp = { 
          name: `地点 ${editCheckpoints.length + 1}`, 
          location: { latitude: lat, longitude: lng },
          heading: 0 
        };
        setEditCheckpoints(prev => [...prev, newCp]);
      },
    });
    return null;
  }

  const handleSaveRoute = async () => {
    if (!user) return alert("ログインが必要です");
    if (!editRouteName.trim()) return alert("コース名を入力してください");
    if (editCheckpoints.length === 0) return alert("最低1つのチェックポイントを配置してください");
    
    const routeData = { 
      uid: user.uid,
      name: editRouteName, 
      checkpoints: editCheckpoints 
    };

    try {
      if (editRouteId) {
        await setDoc(doc(db, 'routes', editRouteId), routeData);
        alert("コースを更新しました！");
      } else {
        await addDoc(collection(db, 'routes'), routeData);
        alert("新しいコースを登録しました！");
      }
      await fetchUserRoutes(user);
      setScreenMode('list');
    } catch (error) { alert("保存に失敗しました"); }
  };

  const handleDeleteRoute = async () => {
    if (!editRouteId) return;
    if (!window.confirm("このコースを完全に削除してもよろしいですか？")) return;
    try {
      await deleteDoc(doc(db, 'routes', editRouteId));
      alert("コースを削除しました");
      await fetchUserRoutes(user);
      setScreenMode('list');
    } catch (error) { alert("削除に失敗しました"); }
  };

  const toggleTracking = () => {
    if (isTracking) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'stopTracking' });
      }
      setIsTracking(false);
      setCurrentLocation(null);
      prevLocationRef.current = null;
    } else {
      if (checkpoints.length === 0) return alert("コースデータがありません");
      if (!navigator.geolocation) return alert("GPS非対応です");
      if (geoError) return alert(geoError);

      globalAudioApproach.play().then(() => globalAudioApproach.pause()).catch(() => {});
      globalAudioPass.play().then(() => globalAudioPass.pause()).catch(() => {});

      setIsTracking(true);
      setElapsedTime(0);
      setLapTimes([]);
      setTargetIndex(0);
      hasWarnedRef.current = false;
      prevLocationRef.current = null;

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const timestamp = Date.now();
          if (prevLocationRef.current) {
            const distanceMoved = getDistanceHubeny(prevLocationRef.current.latitude, prevLocationRef.current.longitude, latitude, longitude);
            const timeDiffSec = (timestamp - prevLocationRef.current.timestamp) / 1000;
            if (timeDiffSec > 0 && (distanceMoved / timeDiffSec) > 10) return;
          }
          setCurrentLocation({ latitude, longitude, timestamp });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'startTracking' });
      }
    }
  };

  useEffect(() => {
    if (!currentLocation) return;
    const { checkpoints: cps, targetIndex: tIdx } = stateRef.current;
    
    if (cps.length === 0 || tIdx >= cps.length) return;
    const currentTargetCp = cps[tIdx];
    if (!currentTargetCp.location) return;

    const cpHeading = currentTargetCp.heading ?? 0; 
    const cbLat = currentTargetCp.location.latitude;
    const cbLng = currentTargetCp.location.longitude;

    const pCurrent = projectToRouteLocalXY(currentLocation.latitude, currentLocation.longitude, cbLat, cbLng, cpHeading);
    
    let pPrev = null;
    if (prevLocationRef.current) {
      pPrev = projectToRouteLocalXY(prevLocationRef.current.latitude, prevLocationRef.current.longitude, cbLat, cbLng, cpHeading);
    }

    const isApproaching = pCurrent.x >= -50 && pCurrent.x <= 0 && pCurrent.y >= -10 && pCurrent.y <= 10;

    if (isApproaching && !hasWarnedRef.current) {
      hasWarnedRef.current = true;
      playApproachNotification(currentTargetCp.name);
    }

    if (pPrev) {
      const crossedLine = pPrev.x <= 0 && pCurrent.x > 0;
      const withinWidth = pCurrent.y >= -10 && pCurrent.y <= 10;

      if (crossedLine && withinWidth && lastActiveCpRef.current !== tIdx) {
        lastActiveCpRef.current = tIdx;
        const isGoal = (tIdx === cps.length - 1);

        const totalDeltaX = pCurrent.x - pPrev.x;
        let t = 0;
        if (totalDeltaX > 0) {
          t = (0 - pPrev.x) / totalDeltaX;
        }

        const prevElapsed = prevLocationRef.current.timestamp - startTimeRef.current;
        const currentElapsed = currentLocation.timestamp - startTimeRef.current;
        const estimatedTime = prevElapsed + t * (currentElapsed - prevElapsed);

        recordLap(currentTargetCp.name, Math.round(estimatedTime), isGoal);
        hasWarnedRef.current = false;

        if (isGoal) {
          setIsTracking(false);
          if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ action: 'stopTracking' });
          }
        } else {
          setTargetIndex(prev => prev + 1);
        }
      }
    }

    if (!isApproaching && pCurrent.x < -50) {
      hasWarnedRef.current = false;
    }

    prevLocationRef.current = currentLocation;
  }, [currentLocation]);

  if (authLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px' }}>読み込み中...</div>;
  }

  if (!user) {
    return (
      <div style={{ padding: '40px 20px', fontFamily: 'sans-serif', maxWidth: '400px', margin: '40px auto', border: '1px solid #e8e8e8', borderRadius: '16px', backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>🏃‍♂️ GPSラン ログイン</h2>
        {authError && <div style={{ color: '#ff4d4f', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', padding: '10px', borderRadius: '6px', fontSize: '14px', marginBottom: '15px' }}>{authError}</div>}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', marginBottom: '5px', color: '#666' }}>メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} placeholder="example@email.com" />
          </div>
          <div style={{ marginBottom: '25px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', marginBottom: '5px', color: '#666' }}>パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} placeholder="••••••••" />
          </div>
          <button type="submit" style={{ width: '100%', padding: '14px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>ログイン</button>
        </form>
      </div>
    );
  }

  const targetCp = checkpoints[targetIndex];
  const distanceToTarget = (currentLocation && targetCp?.location) ? getDistanceHubeny(currentLocation.latitude, currentLocation.longitude, targetCp.location.latitude, targetCp.location.longitude) : null;
  const isWithin40m = distanceToTarget !== null && distanceToTarget < 40;
  const displayDistance = (distanceToTarget !== null && isWithin40m) ? Math.max(0, distanceToTarget) : null;

  const filteredRoutes = routes.filter(route => route.name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', color: '#333' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #eee', marginBottom: '20px' }}>
        <span style={{ fontSize: '13px', color: '#666' }}>👤 {user.email}</span>
        {!isTracking && (
          <button onClick={handleLogout} style={{ padding: '4px 8px', fontSize: '12px', color: '#ff4d4f', border: '1px solid #ff4d4f', background: 'none', borderRadius: '4px', cursor: 'pointer' }}>ログアウト</button>
        )}
      </div>

      {screenMode === 'list' && (
        <div>
          <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>🗺️ マイコース一覧</h2>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input type="text" placeholder="コース名で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ flex: 1, padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
            <button onClick={() => startEditMode(null)} style={{ padding: '0 15px', backgroundColor: '#1890ff', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>➕ 新規作成</button>
          </div>
          <div>
            {filteredRoutes.length === 0 ? <p style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>作成済みのコースがありません。<br/>新規作成からコースを追加してください。</p> : (
              filteredRoutes.map(route => (
                <div key={route.id} style={{ border: '1px solid #e8e8e8', borderRadius: '12px', padding: '15px', marginBottom: '15px', backgroundColor: '#fff' }}>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>{route.name || '名称未設定'}</h3>
                  <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: '#8c8c8c' }}>チェックポイント数: {route.checkpoints?.length || 0} 個</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => startRunningMode(route)} style={{ flex: 1, padding: '10px', backgroundColor: '#52c41a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>🏃‍♂️ このコースを走る</button>
                    <button onClick={() => startEditMode(route)} style={{ padding: '10px 15px', backgroundColor: '#fafafa', color: '#595959', border: '1px solid #d9d9d9', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>✏️ 地点を編集</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {screenMode === 'running' && (
        <div>
          {!isTracking && (
            <button onClick={() => setScreenMode('list')} style={{ background: 'none', border: 'none', color: '#1890ff', fontSize: '14px', cursor: 'pointer', marginBottom: '10px', padding: 0 }}>⬅️ コース一覧に戻る</button>
          )}
          <h2 style={{ textAlign: 'center', marginBottom: '5px' }}>🏃‍♂️ {currentRoute ? currentRoute.name : ''}</h2>
          <p style={{ textAlign: 'center', color: '#666', margin: '0 0 20px 0', fontSize: '14px' }}>全 {checkpoints.length} 個のCP</p>
          <div style={{ textAlign: 'center', background: '#111', color: '#52c41a', padding: '15px', borderRadius: '12px', fontFamily: 'monospace', fontSize: '36px', fontWeight: 'bold', marginBottom: '20px' }}>{formatTime(elapsedTime)}</div>

          {!isTracking && (
            <div style={{ border: '1px dashed #1890ff', borderRadius: '12px', padding: '15px', backgroundColor: '#e6f7ff', marginBottom: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#0050b3', marginBottom: '15px', textAlign: 'center' }}>🔊 各種音量を個別調整 ＆ テスト</div>
              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', width: '50px' }}>🎵 接近:</span>
                <input type="range" min="0" max="1" step="0.05" value={volApproach} onChange={(e) => setVolApproach(parseFloat(e.target.value))} style={{ flex: 1 }} />
                <span style={{ fontSize: '11px', width: '35px', textAlign: 'right' }}>{Math.round(volApproach * 100)}%</span>
                <button onClick={() => testAudio('approach')} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid #91d5ff', borderRadius: '4px', backgroundColor: '#fff', color: '#1890ff' }}>テスト</button>
              </div>
              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', width: '50px' }}>🔔 通過:</span>
                <input type="range" min="0" max="1" step="0.05" value={volPass} onChange={(e) => setVolPass(parseFloat(e.target.value))} style={{ flex: 1 }} />
                <span style={{ fontSize: '11px', width: '35px', textAlign: 'right' }}>{Math.round(volPass * 100)}%</span>
                <button onClick={() => testAudio('pass')} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid #91d5ff', borderRadius: '4px', backgroundColor: '#fff', color: '#1890ff' }}>テスト</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', width: '50px' }}>🗣️ 読上:</span>
                <input type="range" min="0" max="1" step="0.05" value={volSpeech} onChange={(e) => setVolSpeech(parseFloat(e.target.value))} style={{ flex: 1 }} />
                <span style={{ fontSize: '11px', width: '35px', textAlign: 'right' }}>{Math.round(volSpeech * 100)}%</span>
                <button onClick={() => testAudio('speech')} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid #91d5ff', borderRadius: '4px', backgroundColor: '#fff', color: '#1890ff' }}>テスト</button>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <button onClick={toggleTracking} style={{ padding: '15px 30px', fontSize: '18px', fontWeight: 'bold', backgroundColor: isTracking ? '#ff4d4f' : '#52c41a', color: 'white', border: 'none', borderRadius: '30px', width: '100%', cursor: 'pointer' }}>
              {isTracking ? '⏱️ 計測終了' : '🚀 ランニング開始'}
            </button>
          </div>

          {isTracking && targetCp && (
            <div style={{ border: isWithin40m ? '3px solid #ff4d4f' : '1px solid #ccc', borderRadius: '16px', padding: '25px', textAlign: 'center', backgroundColor: isWithin40m ? '#fff1f0' : '#fff', marginBottom: '20px' }}>
              <span style={{ fontSize: '14px', color: '#666' }}>次の通過ポイント ({targetIndex + 1}/{checkpoints.length})</span>
              <h3 style={{ margin: '5px 0 15px 0', fontSize: '24px' }}>{targetCp.name}</h3>
              <div style={{ width: '140px', height: '140px', margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: isWithin40m ? 'rgba(255, 77, 79, 0.15)' : '#eee', borderRadius: '50%' }}>
                <div style={{ fontWeight: 'bold' }}>
                  {isWithin40m && displayDistance !== null ? (
                    <div><span style={{ fontSize: '28px', color: '#ff4d4f' }}>あと{displayDistance.toFixed(0)}m</span></div>
                  ) : (
                    <span style={{ fontSize: '16px', color: '#666' }}>接近中...</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <h3>⏱️ ラップ履歴</h3>
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '10px', backgroundColor: '#f9f9f9' }}>
            {lapTimes.length === 0 ? <p style={{ color: '#999', textAlign: 'center', margin: '20px 0' }}>ここにラップタイムが記録されます</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd', color: '#666', fontSize: '14px' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>地点</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>区間ラップ</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>総合タイム</th>
                  </tr>
                </thead>
                <tbody>
                  {lapTimes.map((lap, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee', fontSize: '15px' }}>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>{lap.cpName}</td>
                      <td style={{ padding: '8px', color: '#1890ff', fontWeight: 'bold' }}>{lap.lapTime}</td>
                      <td style={{ padding: '8px', color: '#666' }}>{lap.totalTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {screenMode === 'edit' && (
        <div>
          <button onClick={() => setScreenMode('list')} style={{ background: 'none', border: 'none', color: '#1890ff', fontSize: '14px', cursor: 'pointer', marginBottom: '10px', padding: 0 }}>⬅️ キャンセルして戻る</button>
          <h2>{editRouteId ? '✏️ コースの編集' : '➕ コースの新規作成'}</h2>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px' }}>コース名:</label>
            <input type="text" value={editRouteName} onChange={(e) => setEditRouteName(e.target.value)} placeholder="例: いつもの朝ラン5kmコース" style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px' }}>🗺️ 地図をタップして追加 (矢印をドラッグ移動可能):</label>
            <div style={{ height: '300px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #ccc' }}>
              <MapContainer center={editCheckpoints.length > 0 ? [editCheckpoints[0].location.latitude, editCheckpoints[0].location.longitude] : [35.6812, 139.7671]} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapClickHandler />
                
                {editCheckpoints.map((cp, idx) => (
                  <Marker 
                    /* 🌟 角度が変わるごとに一意の key になるように、角度情報（heading）を結合 */
                    /* これにより、数値が変わった瞬間に古いピンが破棄され、新しい向きの矢印が即座に描画されます */
                    key={`${idx}-${cp.heading ?? 0}`} 
                    position={[cp.location.latitude, cp.location.longitude]}
                    icon={createArrowIcon(cp.heading ?? 0, idx)}
                    draggable={true}
                    eventHandlers={{
                      dragend: (e) => {
                        const marker = e.target;
                        const position = marker.getLatLng();
                        const updated = [...editCheckpoints];
                        updated[idx].location = { latitude: position.lat, longitude: position.lng };
                        setEditCheckpoints(updated);
                      },
                    }}
                  >
                    <Popup>
                      <strong>{idx + 1}: {cp.name}</strong><br />
                      設定方位角: {cp.heading ?? 0}°
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
          <div style={{ marginBottom: '25px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>📍 チェックポイント詳細設定 (数値入力で自動同期):</label>
            {editCheckpoints.length === 0 ? <p style={{ color: '#999', fontSize: '14px', fontStyle: 'italic' }}>上の地図をタップして地点を追加してください。</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {editCheckpoints.map((cp, idx) => (
                  <div key={idx} style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', border: '1px solid #e8e8e8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontWeight: 'bold', color: '#1890ff', fontSize: '16px' }}>地点 {idx + 1}</span>
                      <button onClick={() => { const updated = editCheckpoints.filter((_, i) => i !== idx); setEditCheckpoints(updated); }} style={{ padding: '4px 8px', backgroundColor: '#ff4d4f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>この地点を削除</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '2px' }}>地点名</label>
                        <input type="text" value={cp.name} onChange={(e) => { const updated = [...editCheckpoints]; updated[idx].name = e.target.value; setEditCheckpoints(updated); }} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '2px' }}>進行方向角 (北0°〜東90°)</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <input type="number" min="0" max="359" value={cp.heading ?? 0} onChange={(e) => { const updated = [...editCheckpoints]; let val = parseInt(e.target.value) || 0; if (val < 0) val = 0; if (val > 359) val = 359; updated[idx].heading = val; setEditCheckpoints(updated); }} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                          <span style={{ fontSize: '14px' }}>°</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '2px' }}>緯度 (Latitude)</label>
                        <input type="number" step="0.000001" value={cp.location.latitude} onChange={(e) => { const updated = [...editCheckpoints]; updated[idx].location.latitude = parseFloat(e.target.value) || 0; setEditCheckpoints(updated); }} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '2px' }}>経度 (Longitude)</label>
                        <input type="number" step="0.000001" value={cp.location.longitude} onChange={(e) => { const updated = [...editCheckpoints]; updated[idx].location.longitude = parseFloat(e.target.value) || 0; setEditCheckpoints(updated); }} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button onClick={handleSaveRoute} style={{ padding: '14px', backgroundColor: '#52c41a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>💾 コースを保存する</button>
            {editRouteId && <button onClick={handleDeleteRoute} style={{ padding: '10px', backgroundColor: 'transparent', color: '#ff4d4f', border: '1px solid #ff4d4f', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}>🗑️ このコース自体を削除する</button>}
          </div>
        </div>
      )}
    </div>
  );
}