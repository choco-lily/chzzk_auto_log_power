let powerTimer = null;
let clockToggle = false;

// 다음 파워 획득 시간 계산
function calculateNextPowerTime() {
    chrome.storage.local.get(['powerLogs', 'lastPowerAcquisitionTime'], (result) => {
        const logs = result.powerLogs || [];
        const lastAcquisitionTime = result.lastPowerAcquisitionTime;
        const now = new Date();
        
        let nextPowerTime;
        
        if (lastAcquisitionTime) {
            // 마지막 획득 시간이 있으면 그 시간부터 1시간 후
            const lastTime = new Date(lastAcquisitionTime);
            nextPowerTime = new Date(lastTime.getTime() + 60 * 60 * 1000);
            
            // 이미 1시간이 지났으면 현재 시간 기준으로 재계산
            if (nextPowerTime <= now) {
                nextPowerTime = calculateFromLastLog(logs, now);
            }
        } else {
            // 마지막 획득 시간이 없으면 마지막 로그 기준으로 계산
            nextPowerTime = calculateFromLastLog(logs, now);
        }
        
        updateTimeDisplay(nextPowerTime);
    });
}

// 마지막 로그 기준으로 다음 획득 시간 계산
function calculateFromLastLog(logs, now) {
    if (logs.length === 0) {
        // 로그가 없으면 현재 시간부터 1시간 후
        return new Date(now.getTime() + 60 * 60 * 1000);
    }
    
    // 가장 최근 로그 찾기
    const lastLog = logs[0];
    const lastLogTime = new Date(lastLog.timestamp);
    
    // 현재 시간의 분을 마지막 로그의 분으로 설정
    const nextTime = new Date(now);
    nextTime.setMinutes(lastLogTime.getMinutes());
    nextTime.setSeconds(0);
    nextTime.setMilliseconds(0);
    
    // 현재 시간보다 이전이면 다음 시간으로 설정
    if (nextTime <= now) {
        nextTime.setHours(nextTime.getHours() + 1);
    }
    
    return nextTime;
}

// 시간 표시 업데이트
function updateTimeDisplay(nextPowerTime) {
    const timeDisplay = document.getElementById('timeDisplay');
    const now = new Date();
    const diffMs = nextPowerTime.getTime() - now.getTime();
    
    if (diffMs <= 0) {
        timeDisplay.textContent = '곧 획득 가능';
        return;
    }
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    
    if (hours > 0) {
        timeDisplay.textContent = `${hours}시간 ${minutes}분 후`;
    } else {
        timeDisplay.textContent = `${minutes}분 후`;
    }
}

// 타이머 시작
function startPowerTimer() {
    if (powerTimer) {
        clearInterval(powerTimer);
    }
    
    // 즉시 계산
    calculateNextPowerTime();
    
    // 1분마다 업데이트
    powerTimer = setInterval(calculateNextPowerTime, 60 * 1000);
}

// 마지막 파워 획득 시간 저장
function saveLastPowerAcquisitionTime() {
    chrome.storage.local.set({ lastPowerAcquisitionTime: new Date().toISOString() });
}

onload = (event) => {
    chrome.storage.sync.get(["badge", "clockToggle"], (r) => {
        if (r.badge == undefined) {
            r.badge = true;
            chrome.storage.sync.set({ badge: true });
        }
        if (r.clockToggle == undefined) {
            r.clockToggle = false;
            chrome.storage.sync.set({ clockToggle: false });
        }

        let checkbox = document.getElementById("toggle");
        checkbox.checked = r.badge;
        checkbox.addEventListener("change", () => {
            chrome.storage.sync.set({ badge: checkbox.checked });
            // 즉시 content script에 변경사항 전달
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('chzzk.naver.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updateBadgeToggle',
                        badgeToggle: checkbox.checked
                    });
                }
            });
        });

        let clockCheckbox = document.getElementById("clockToggle");
        clockCheckbox.checked = r.clockToggle;
        clockToggle = r.clockToggle;
        clockCheckbox.addEventListener("change", () => {
            chrome.storage.sync.set({ clockToggle: clockCheckbox.checked });
            clockToggle = clockCheckbox.checked;
            // 즉시 content script에 변경사항 전달
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('chzzk.naver.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updateClockToggle',
                        clockToggle: clockCheckbox.checked
                    });
                }
            });
        });
    });

    // 로그 보기 버튼 이벤트
    document.getElementById("viewLogs").addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("log.html") });
    });
    
    // 파워 타이머 시작
    startPowerTimer();
};

// 파워 획득 시 호출할 함수 (content script에서 메시지로 호출)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'powerAcquired') {
        saveLastPowerAcquisitionTime();
        calculateNextPowerTime();
    }
});
