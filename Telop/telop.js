// P2P地震情報モニタリングシステム
let lastEarthquakeId = null;
let ws;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5秒

const mainAlert = document.getElementById('main-alert');
const eqDetails = document.getElementById('eq-details');
const intensityInfo = document.getElementById('intensity-info');
const endAlert = document.getElementById('end-alert');
const alertSound = document.getElementById('alert-sound');

let stations = {};

console.log("地震情報を取得中...");

// WebSocket接続を確立する関数
function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;

    ws = new WebSocket('wss://api-realtime-sandbox.p2pquake.net/v2/ws');

    ws.onopen = () => {
        console.log('WebSocket接続が確立されました');
        isConnecting = false;
        reconnectAttempts = 0;
        playSound(); // 接続確認音
    };

    // 地震情報キューを追加
    let earthquakeQueue = [];
    let isProcessing = false;

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // EEW（554）と地震情報（551）を処理
        if (data.code === 554) {
            console.log('緊急地震速報を受信しました:', data);
            showEEWAlert(data);
        } else if (data.code === 551) {
            console.log('地震情報を受信しました:', data);
            // キューに追加して処理を開始
            earthquakeQueue.push(data);
            processEarthquakeQueue();
        }
    };

    // キューを処理する関数
    async function processEarthquakeQueue() {
        if (isProcessing || earthquakeQueue.length === 0) return;
        
        isProcessing = true;
        
        try {
            while (earthquakeQueue.length > 0) {
                const data = earthquakeQueue[0]; // キューの先頭を取得
                await showEarthquakeInfo(data);
                earthquakeQueue.shift(); // 処理完了した情報を削除
            }
        } catch (error) {
            console.error('地震情報キューの処理中にエラーが発生しました:', error);
        } finally {
            isProcessing = false;
        }
    }

    ws.onclose = () => {
        console.log('WebSocket接続が切断されました');
        isConnecting = false;
        
        // 再接続を試みる
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`再接続を試みます... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(connectWebSocket, RECONNECT_DELAY);
        } else {
            console.error('最大再接続試行回数に達しました');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocketエラー:', error);
        isConnecting = false;
    };
}

// 震度情報を整形する関数
function formatIntensityInfo(points) {
    let intensityText = '';
    const intensityGroups = {};
    
    // 震度の変換関数
    function convertIntensity(scale) {
        switch(scale) {
            case 10: return "1";
            case 20: return "2";
            case 30: return "3";
            case 40: return "4";
            case 45: return "5弱";
            case 50: return "5強";
            case 55: return "6弱";
            case 60: return "6強";
            case 70: return "7";
            default: return "不明";
        }
    }

    // Group areas by intensity and remove duplicates
    points.forEach(point => {
        const intensity = convertIntensity(point.scale);
        const city = stations[point.addr] || point.addr; // 市町村名に変換
        if (!intensityGroups[intensity]) {
            intensityGroups[intensity] = [];
        }
        intensityGroups[intensity].push(city);
    });
    
    // Sort intensities in descending order
    const intensityOrder = ["7", "6強", "6弱", "5強", "5弱", "4", "3", "2", "1"];
    
    // Format each intensity group
    intensityOrder.forEach(intensity => {
        if (intensityGroups[intensity] && intensityGroups[intensity].length > 0) {
            const areas = intensityGroups[intensity];
            let lines = [];
            let currentLine = '';
            let currentLineLength = 0;
            let firstLineOfIntensity = true;
            
            areas.forEach(city => {
                const nextLength = currentLineLength + city.length + 1;
                
                if (nextLength > 32 && currentLine) {
                    // 現在の行を配列に追加
                    lines.push(currentLine.trim());
                    currentLine = city + '　';
                    currentLineLength = city.length + 1;
                    firstLineOfIntensity = false;
                } else {
                    currentLine += city + '　';
                    currentLineLength = nextLength;
                }
            });

            // 最後の行を追加
            if (currentLine.trim()) {
                lines.push(currentLine.trim());
            }

            // 震度表示を追加
            const formattedLines = lines.map((line, index) => {
                if (index === 0 || firstLineOfIntensity) {
                    return `　　<span class="intensity-label">震度${intensity}</span>　${line}`;
                }
                return `　　　　${line}`;
            });

            // 行を結合して追加（震度グループごとに改行を2回入れる）
            intensityText += formattedLines.join('\n') + '\n\n';
            firstLineOfIntensity = true;
        }
    });
    
    // 最後の余分な改行を削除して行を分割
    return intensityText.trim().split('\n');
}

// 地震情報を表示する関数
async function showEarthquakeInfo(data) {
    try {
        // データの存在チェックを追加
        if (!data || !data.earthquake || !data.earthquake.hypocenter) {
            console.error('地震情報のデータ構造が不正です:', data);
            return;
        }

        // 完了するまで1回だけ実行（ループを削除）
        playSound();

        mainAlert.classList.remove('hidden');
        await sleep(3000);
        mainAlert.classList.add('hidden');

        // 地震情報を2行に分けて表示（マグニチュードの判定を修正）
        const details = [
            `震源地：${data.earthquake.hypocenter.name || '不明'}　　震源の深さ：${data.earthquake.hypocenter.depth || '不明'}km`,
            `マグニチュード：${data.earthquake.magnitude != null ? 'M' + data.earthquake.magnitude.toFixed(1) : '不明'}　　津波の有無：${data.earthquake.domesticTsunami === "None" ? "なし" : "有り"}`
        ].join('\n');

        eqDetails.textContent = details;
        eqDetails.classList.remove('hidden');
        await sleep(5000);
        eqDetails.classList.add('hidden');

        // 3. 各地の震度情報を表示（5秒間ずつ）
        const intensityInfoText = formatIntensityInfo(data.points);
        
        if (intensityInfoText.length === 0) {
            return;
        }
        
        let index = 0;
        while (index < intensityInfoText.length) {
            const remainingLines = intensityInfoText.length - index;
            const linesToShow = intensityInfoText.slice(index, index + 2).join('<br>');
            
            console.log(`残り ${remainingLines - 2} 行`);
            
            intensityInfo.innerHTML = linesToShow;
            intensityInfo.style.textAlign = 'left';
            intensityInfo.style.margin = '0 auto';
            intensityInfo.style.width = 'fit-content';
            intensityInfo.classList.remove('hidden');
            await sleep(5000);
            intensityInfo.classList.add('hidden');
            index += 2;
        }

        // 4. 終了表示（3秒間）
        endAlert.classList.remove('hidden');
        await sleep(3000);
        endAlert.classList.add('hidden');

        await sleep(2000);
    } catch (error) {
        console.error('地震情報の表示中にエラーが発生しました:', error);
    }
}

// EEW警報を表示する関数
async function showEEWAlert(data) {
    const eewAlert = document.getElementById('eew-alert');
    const eewEpicenter = document.getElementById('eew-epicenter');
    const eewMagnitude = document.getElementById('eew-magnitude');
    const eewDepth = document.getElementById('eew-depth');
    const eewAreas = document.getElementById('eew-areas');

    // 警報音を再生
    const alertSound = new Audio('eew_alert.wav');
    alertSound.play().catch(error => console.error('警報音の再生に失敗しました:', error));

    // 情報を表示
    eewEpicenter.textContent = `震源地: ${data.earthquake.hypocenter.name}`;
    eewMagnitude.textContent = `マグニチュード: M${data.earthquake.magnitude.toFixed(1)}`;
    eewDepth.textContent = `深さ: ${data.earthquake.hypocenter.depth}km`;
    eewAreas.textContent = `警報対象地域: ${data.areas.map(area => area.name).join('、')}`;

    // 警報を表示
    eewAlert.classList.remove('hidden');

    // 10秒後に警報を非表示
    await sleep(10000);
    eewAlert.classList.add('hidden');
}

// ユーティリティ関数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function playSound() {
    const audio = new Audio('nc284095_ピーン・起動音、スタート、アイキャッチ_pibell.wav');
    document.addEventListener('click', () => {
        audio.play().catch(error => console.error('音声の再生に失敗しました:', error));
    }, { once: true });
}

// ページ読み込み時にWebSocket接続を開始
window.addEventListener('load', () => {
    // 非同期関数を定義して実行
    (async () => {
        // 市町村データの読み込み
        stations = await fetch('stations.json').then(response => response.json());
        
        connectWebSocket();
    })();
});
