let allLogs = [];
let filteredLogs = [];

// 페이지 로드 시 실행
document.addEventListener('DOMContentLoaded', function() {
    loadLogs();
    setupFilters();
    setupThemeToggle();
    // 최대 저장치 UI 초기화
    chrome.storage.sync.get(['maxLogs'], (r) => {
        const input = document.getElementById('maxLogsInput');
        if (input) input.value = (r && typeof r.maxLogs==='number' && r.maxLogs>0) ? r.maxLogs : 10000;
    });
    const saveMaxBtn = document.getElementById('saveMaxLogsBtn');
    if (saveMaxBtn) {
        saveMaxBtn.addEventListener('click', () => {
            const input = document.getElementById('maxLogsInput');
            const val = Number(input && input.value);
            const maxLogs = Number.isFinite(val) && val>0 ? Math.floor(val) : 10000;
            chrome.storage.sync.set({ maxLogs }, () => {
                input.value = maxLogs;
            });
        });
    }
    // 예측 별도 집계 설정 로드
    chrome.storage.sync.get(['splitPredictionStats'], (r) => {
        const cb = document.getElementById('splitPredictionStats');
        const val = !!r.splitPredictionStats;
        if (cb) {
            cb.checked = val;
            cb.addEventListener('change', () => {
                chrome.storage.sync.set({ splitPredictionStats: cb.checked });
                updateStats();
            });
        }
    });
    setupImportExport();
    const clearBtn = document.getElementById('clearLogsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllLogs);
    }
    const testAddBtn = document.getElementById('testAddBtn');
    if (testAddBtn) {
        testAddBtn.addEventListener('click', () => openTestLogModal(0));
    }
});
// 치지직 탭을 통해 content script 프록시로 상세를 가져오기 (CORS 회피)
async function proxyFetchPredictionDetail(channelId, predictionId) {
    const patterns = ["https://chzzk.naver.com/*", "http://chzzk.naver.com/*"];
    const tabs = await new Promise((resolve) => {
        try {
            chrome.tabs.query({ url: patterns }, (ts) => resolve(ts || []));
        } catch (_) {
            resolve([]);
        }
    });
    for (const tab of tabs) {
        const resp = await new Promise((resolve) => {
            try {
                chrome.tabs.sendMessage(tab.id, { action: 'fetchPredictionDetail', channelId, predictionId }, (r) => {
                    if (chrome.runtime && chrome.runtime.lastError) return resolve(null);
                    resolve(r || null);
                });
            } catch (_) {
                resolve(null);
            }
        });
        if (resp && resp.ok) return resp.data;
    }
    throw new Error('프록시 실패(치지직 탭 연결 불가)');
}

// 테마 토글 설정
function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const body = document.body;
    
    // 저장된 테마 불러오기 (기본값: 다크모드)
    const savedTheme = localStorage.getItem('theme') || 'dark';
    body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    // 테마 토글 이벤트
    themeToggle.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

// 테마 아이콘 업데이트
function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.title = theme === 'dark' ? '라이트모드로 변경' : '다크모드로 변경';
}

// 토스트 알림 유틸
let toastContainer;
function ensureToastResources() {
	if (!toastContainer) {
		toastContainer = document.createElement('div');
		toastContainer.id = 'toastContainer';
		document.body.appendChild(toastContainer);
	}
	if (!document.getElementById('toastStyles')) {
		const style = document.createElement('style');
		style.id = 'toastStyles';
		style.textContent = `
			#toastContainer { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
			.toast { min-width: 200px; max-width: 360px; padding: 10px 12px; border-radius: 8px; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; transform: translateY(8px); transition: opacity .2s ease, transform .2s ease; font-size: 13px; }
			.toast.show { opacity: 1; transform: translateY(0); }
			.toast-info { background: #4b5563; }
			.toast-success { background: #16a34a; }
			.toast-error { background: #dc2626; }
		`;
		document.head.appendChild(style);
	}
}

function showToast(message, type = 'info', durationMs = 1500) {
	ensureToastResources();
	const el = document.createElement('div');
	el.className = `toast toast-${type}`;
	el.textContent = message;
	toastContainer.appendChild(el);
	// 애니메이션 표시
	requestAnimationFrame(() => el.classList.add('show'));
	// 자동 제거
	setTimeout(() => {
		el.classList.remove('show');
		setTimeout(() => {
			if (el.parentNode) el.parentNode.removeChild(el);
		}, 200);
	}, durationMs);
}

// 확인 모달 유틸 (기존 편집 모달 스타일 재사용)
function ensureConfirmResources() {}

function showConfirm(message, { title = '확인', okText = '확인', cancelText = '취소', destructive = false } = {}) {
	ensureConfirmResources();
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'edit-modal-overlay';
		const modal = document.createElement('div');
		modal.className = 'edit-modal';
		modal.innerHTML = `
			<div class="edit-modal-header">
				<h3>${title}</h3>
				<button class="close-btn" id="closeConfirmModal">×</button>
			</div>
			<div class="edit-modal-content">
				<div style="font-size:14px; line-height:1.6;">${message}</div>
			</div>
			<div class="edit-modal-footer">
				<button class="cancel-btn" id="confirmCancelBtn">${cancelText}</button>
				<button class="${destructive ? 'modal-delete-btn' : 'save-btn'}" id="confirmOkBtn">${okText}</button>
			</div>
		`;
		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		const cleanup = () => { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); };
		overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(false); } });
		modal.querySelector('#closeConfirmModal').addEventListener('click', () => { cleanup(); resolve(false); });
		modal.querySelector('#confirmCancelBtn').addEventListener('click', () => { cleanup(); resolve(false); });
		modal.querySelector('#confirmOkBtn').addEventListener('click', () => { cleanup(); resolve(true); });
		// ESC 키 처리
		document.addEventListener('keydown', function onKey(e){ if(e.key==='Escape'){ document.removeEventListener('keydown', onKey); cleanup(); resolve(false);} });
	});
}

// 로그 데이터 로드
async function loadLogs() {
    try {
        const result = await chrome.storage.local.get(['powerLogs']);
        allLogs = result.powerLogs || [];
        filteredLogs = [...allLogs];
        
        updateStats();
        renderLogs();
        
        // 로딩 숨기기
        document.getElementById('loading').style.display = 'none';
    } catch (error) {
        console.error('로그 로드 실패:', error);
        document.getElementById('loading').innerHTML = '<p>로그를 불러오는데 실패했습니다.</p>';
    }
}

// 통계 업데이트
function updateStats() {
    // 기간별 집계 업데이트
    updatePeriodStats();
}

// 기간별 집계 업데이트
function updatePeriodStats() {
    const now = new Date();
    
    // 오늘
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayLogs = allLogs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= today;
    });
    const todayPred = todayLogs.filter(l => String(l.method||'').toLowerCase()==='prediction');
    const todayCount = todayLogs.length;
    const todayPower = todayLogs.reduce((sum, log) => {
        const amount = typeof log.amount === 'number' ? log.amount : 0;
        return sum + amount;
    }, 0);
    const todayChannels = new Set(todayLogs.map(log => log.channelId)).size;
    
    // 이번 주 (월요일부터)
    const startOfWeek = new Date(today);
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(today.getDate() - daysToMonday);
    const weekLogs = allLogs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= startOfWeek;
    });
    const weekPred = weekLogs.filter(l => String(l.method||'').toLowerCase()==='prediction');
    const weekCount = weekLogs.length;
    const weekPower = weekLogs.reduce((sum, log) => {
        const amount = typeof log.amount === 'number' ? log.amount : 0;
        return sum + amount;
    }, 0);
    const weekChannels = new Set(weekLogs.map(log => log.channelId)).size;
    
    // 이번 달
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLogs = allLogs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= startOfMonth;
    });
    const monthPred = monthLogs.filter(l => String(l.method||'').toLowerCase()==='prediction');
    const monthCount = monthLogs.length;
    const monthPower = monthLogs.reduce((sum, log) => {
        const amount = typeof log.amount === 'number' ? log.amount : 0;
        return sum + amount;
    }, 0);
    const monthChannels = new Set(monthLogs.map(log => log.channelId)).size;
    
    // 전체 기간
    const allCount = allLogs.length;
    const allPower = allLogs.reduce((sum, log) => {
        const amount = typeof log.amount === 'number' ? log.amount : 0;
        return sum + amount;
    }, 0);
    const allChannels = new Set(allLogs.map(log => log.channelId)).size;
    const allPred = allLogs.filter(l => String(l.method||'').toLowerCase()==='prediction');
    
    // 날짜 범위 설정
    const todayDate = now.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    const weekStartDate = startOfWeek.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    const weekEndDate = now.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    const monthDate = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
    
    // 전체 기간 날짜 (첫 로그부터)
    let allDateRange = '전체';
    if (allLogs.length > 0) {
        const firstLog = new Date(allLogs[allLogs.length - 1].timestamp);
        const lastLog = new Date(allLogs[0].timestamp);
        allDateRange = `${firstLog.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} ~ ${lastLog.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}`;
    }
    
    // 예측 별도 집계 및 메인 통계 업데이트
    chrome.storage.sync.get(['splitPredictionStats'], (r) => {
        const enabled = !!r.splitPredictionStats;
        const notPred = (l) => String(l.method||'').toLowerCase()!=='prediction';
        const tl = enabled ? todayLogs.filter(notPred) : todayLogs;
        const wl = enabled ? weekLogs.filter(notPred) : weekLogs;
        const ml = enabled ? monthLogs.filter(notPred) : monthLogs;
        const al = enabled ? allLogs.filter(notPred) : allLogs;

        const tCount = tl.length;
        const tPower = tl.reduce((s,l)=>s+(typeof l.amount==='number'?l.amount:0),0);
        const tChannels = new Set(tl.map(l=>l.channelId)).size;
        const wCount = wl.length;
        const wPower = wl.reduce((s,l)=>s+(typeof l.amount==='number'?l.amount:0),0);
        const wChannels = new Set(wl.map(l=>l.channelId)).size;
        const mCount = ml.length;
        const mPower = ml.reduce((s,l)=>s+(typeof l.amount==='number'?l.amount:0),0);
        const mChannels = new Set(ml.map(l=>l.channelId)).size;
        const aCount = al.length;
        const aPower = al.reduce((s,l)=>s+(typeof l.amount==='number'?l.amount:0),0);
        const aChannels = new Set(al.map(l=>l.channelId)).size;

        document.getElementById('todayCount').textContent = `${tCount}회`;
        document.getElementById('todayPower').textContent = `${tPower.toLocaleString()}개`;
        document.getElementById('todayChannels').textContent = `${tChannels}개`;
        document.getElementById('todayDate').textContent = todayDate;

        document.getElementById('weekCount').textContent = `${wCount}회`;
        document.getElementById('weekPower').textContent = `${wPower.toLocaleString()}개`;
        document.getElementById('weekChannels').textContent = `${wChannels}개`;
        document.getElementById('weekDate').textContent = `${weekStartDate} ~ ${weekEndDate}`;

        document.getElementById('monthCount').textContent = `${mCount}회`;
        document.getElementById('monthPower').textContent = `${mPower.toLocaleString()}개`;
        document.getElementById('monthChannels').textContent = `${mChannels}개`;
        document.getElementById('monthDate').textContent = monthDate;

        document.getElementById('allCount').textContent = `${aCount}회`;
        document.getElementById('allPower').textContent = `${aPower.toLocaleString()}개`;
        document.getElementById('allChannels').textContent = `${aChannels}개`;
        document.getElementById('allDate').textContent = allDateRange;

        const setLine = (id, arr) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (!enabled) { el.style.display = 'none'; return; }
            const count = arr.length;
            const power = arr.reduce((s, l) => s + (typeof l.amount==='number'? l.amount: 0), 0);
            el.textContent = `승부예측: 횟수 ${count.toLocaleString()}회 / 통나무 ${power.toLocaleString()}개`;
            el.style.display = 'block';
        };
        setLine('todayPredLine', todayPred);
        setLine('weekPredLine', weekPred);
        setLine('monthPredLine', monthPred);
        setLine('allPredLine', allPred);
    });
}

// 로그 렌더링
function renderLogs() {
    const logsList = document.getElementById('logsList');
    
    if (filteredLogs.length === 0) {
        logsList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">🌲</div>
                <h3>로그가 없습니다</h3>
                <p>치지직에서 통나무 파워를 획득하면<br>여기에 기록이 표시됩니다.</p>
            </div>
        `;
        return;
    }
    
    logsList.innerHTML = filteredLogs.map(log => {
        const date = new Date(log.timestamp);
        const formattedDate = date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const methodClass = getMethodClass(log.method);
        let methodText = getMethodText(log.method);
        // VIEW + 구독 티어별 라벨 보강
        if (String(log.method || '').toUpperCase() === 'VIEW') {
            const amt = typeof log.amount === 'number' ? log.amount : NaN;
            if (amt === 120) methodText = '시청 - 1티어 구독';
            else if (amt === 200) methodText = '시청 - 2티어 구독';
        }
        
        const isPrediction = String(log.method || '').toLowerCase() === 'prediction';
        const detailsBtn = isPrediction && log.predictionId ? `<button class="detail-btn" data-channel-id="${log.channelId}" data-prediction-id="${log.predictionId}">상세</button>` : '';
        return `
            <div class="log-item" data-log-index="${filteredLogs.indexOf(log)}">
                <img src="${log.channelImageUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjQiIGZpbGw9IiNFMkU4RjAiLz4KPHN2ZyB4PSIxMiIgeT0iMTIiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj4KPHBhdGggZD0iTTEyIDJDMTMuMSAyIDE0IDIuOSAxNCA0VjEwQzE0IDExLjEgMTMuMSAxMiAxMiAxMkMxMC45IDEyIDEwIDExLjEgMTAgMTBWNFMxMC45IDIgMTIgMloiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTEyIDE0QzEzLjEgMTQgMTQgMTQuOSAxNCAxNlYyMEMxNCAyMS4xIDEzLjEgMjIgMTIgMjJDMTAuOSAyMiAxMCAyMS4xIDEwIDIwVjE2QzEwIDE0LjkgMTAuOSAxNCAxMiAxNFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+Cjwvc3ZnPg=='}" 
                     alt="${log.channelName}" class="channel-image">
                <div class="log-content">
                    <div class="channel-name">
                        <a href="https://chzzk.naver.com/${log.channelId}" target="_blank" class="channel-link">
                            ${log.channelName}${log.verifiedMark ? ' <img src="https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png" alt="인증" style="width:16px;height:16px;vertical-align:middle;margin-left:2px;">' : ''}
                        </a> ${detailsBtn}
                    </div>
                    <div class="log-details">
                        <span class="method-badge ${methodClass}">${methodText}</span>
                        <span class="timestamp">${formattedDate}</span>
                    </div>
                    ${isPrediction ? `<div class="prediction-details" data-for="${log.predictionId}" style="display:none;margin-top:8px;"></div>` : ''}
                </div>
                <div class="log-actions">
                    ${(() => {
                        const val = typeof log.amount === 'number' ? log.amount : Number(log.amount) || 0;
                        const sign = val < 0 ? '-' : '+';
                        const cls = val < 0 ? 'amount amount-neg' : 'amount amount-pos';
                        const absVal = Math.abs(val);
                        return `<div class="${cls}">${sign}${absVal.toLocaleString()}</div>`;
                    })()}
                    <div class="action-buttons">
                        <button class="edit-btn" data-log-index="${filteredLogs.indexOf(log)}">수정</button>
                        <button class="delete-btn" data-log-index="${filteredLogs.indexOf(log)}">삭제</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // 이벤트 리스너 추가
    addEventListeners();
}

// 이벤트 리스너 추가 함수
function addEventListeners() {
    // 편집 버튼 이벤트 리스너
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logIndex = parseInt(e.target.getAttribute('data-log-index'));
            editLog(logIndex);
        });
    });
    
    // 삭제 버튼 이벤트 리스너
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logIndex = parseInt(e.target.getAttribute('data-log-index'));
            deleteLog(logIndex);
        });
    });

    // 테스트 버튼 이벤트 리스너
    document.querySelectorAll('.test-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logIndex = parseInt(e.target.getAttribute('data-log-index'));
            openTestLogModal(logIndex);
        });
    });
    // 승부예측 상세 버튼
    document.querySelectorAll('.detail-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const channelId = e.currentTarget.getAttribute('data-channel-id');
            const predictionId = e.currentTarget.getAttribute('data-prediction-id');
            if (!channelId || !predictionId) return;
            const container = e.currentTarget.closest('.log-item').querySelector(`.prediction-details[data-for="${predictionId}"]`);
            if (!container) return;
            // 토글: 이미 열려있으면 닫고 반환 (추가 요청 없음)
            if (container.style.display !== 'none' && container.innerHTML && container.innerHTML.trim() !== '') {
                container.style.display = 'none';
                return;
            }
            try {
                container.style.display = 'block';
                container.innerHTML = '<div style="color:#aaa;font-size:12px;">불러오는 중...</div>';
                // 우선 활성 Chzzk 탭의 content script에 프록시 요청 (CORS 회피)
                const data = await proxyFetchPredictionDetail(channelId, predictionId);
                const c = data && data.content ? data.content : null;
                if (!c) throw new Error('데이터 없음');
                const status = String(c.status || '').toUpperCase();
                if (!(status === 'EXPIRED' || status === 'CANCELLED' || status === 'COMPLETED')) {
                    container.innerHTML = '<div style="color:#aaa;font-size:12px;">참여 마감 전까지는 확인이 불가능합니다.</div>';
                    return;
                }
                const opts = Array.isArray(c.optionList) ? c.optionList : [];
                const mk = (n) => typeof n === 'number' ? n.toLocaleString() : n;
                const mkNum = (n) => typeof n === 'number' ? n.toLocaleString() : n;
                const selected = c.participation ? c.participation.selectedOptionNo : null;
                const usedPower = c.participation ? c.participation.bettingPowers : null;
                const wonPower = c.participation && typeof c.participation.winningPowers === 'number' ? c.participation.winningPowers : null;
                const netWon = (typeof wonPower === 'number' ? wonPower : 0) - (typeof usedPower === 'number' ? usedPower : 0);

                // 저장소와 불일치 시 즉시 저장소의 예측 로그 금액을 (winningPowers - bettingPowers)로 덮어쓰기
                if (wonPower != null && wonPower >= 1) {
                    try {
                        const store = await chrome.storage.local.get(['powerLogs']);
                        const logs = store.powerLogs || [];
                        let updated = false;
                        for (let i = 0; i < logs.length; i++) {
                            const l = logs[i];
                            const desired = Math.max(0, ((typeof wonPower==='number'?wonPower:0) - (typeof usedPower==='number'?usedPower:0)));
                            if (l && String(l.method||'').toLowerCase()==='prediction' && l.predictionId === predictionId && typeof l.amount === 'number' && l.amount !== desired) {
                                logs[i] = { ...l, amount: desired };
                                updated = true;
                            }
                        }
                        if (updated) {
                            await chrome.storage.local.set({ powerLogs: logs });
                            // 메모리 데이터도 최신화
                            allLogs = logs.slice();
                            applyFilters();
                            updateStats();
                            renderLogs();
                        }
                    } catch (_) {}
                }
                const renderOption = (o) => {
                    const pct = typeof o.percentage === 'number' ? o.percentage : Math.round((o.totalLogPowers || 0) / Math.max(1, opts.reduce((s,x)=>s+(x.totalLogPowers||0),0)) * 100);
                    const isSelected = Number(o.optionNo)===Number(selected);
                    const isWinner = Number(o.optionNo)===Number(c.winningOptionNo);
                    const hasWinner = c.winningOptionNo != null;
                    const selectColor = isSelected ? (hasWinner ? (isWinner ? '#25ae66' : '#e23c3c') : '#25ae66') : null; // green if win, red if lose, black if no winner
                    const borderCss = isSelected ? `1px solid ${selectColor}` : '1px solid var(--border-color)';
                    const barColor = isWinner ? '#25ae66' : ('#2a6aff');
                    return `
                        <div style="border:${borderCss};border-radius:8px;padding:10px;margin:8px 0;${isWinner?`background:#0f2f23 url('https://ssl.pstatic.net/static/nng/glive/icon/power/prediction_power_win.png') no-repeat right 0px top 0px / 100px;`:''}">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                                <div style="font-weight:700;">${o.optionText || ''}</div>
                                <div style="font-weight:800;">${pct}%</div>
                            </div>
                            <div style="height:6px;background:var(--bg-tertiary);border-radius:4px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:${barColor};"></div>
                            </div>
                            <div style="display:flex;gap:12px;color:#aaa;font-size:12px;margin-top:6px;align-items:center;">
                                <span>👥 ${mk(o.participantCount)}</span>
                                <span>🪵 ${mkNum(o.totalLogPowers)}</span>
                                <span>⚖️ 1:${o.distributionRate ?? '-'}</span>
                            </div>
                        </div>`;
                };
                const statusBanner = (status === 'EXPIRED') ? `<div style=\"margin:-2px 0 6px 0;color:#ffcc00;font-size:12px;\">아직 승부예측이 진행중입니다.</div>` : '';
                container.innerHTML = `
                    <div style="border:1px solid var(--border-color);border-radius:10px;padding:10px;">
                        ${statusBanner}
                        <div style="font-weight:700;margin-bottom:8px;">${c.predictionTitle || '승부예측'}</div>
                        ${opts.map(renderOption).join('')}
                        ${usedPower!=null ? `<div style=\"margin-top:4px;color:#aaa;font-size:12px;display:flex;justify-content:flex-end;gap:6px;\">사용 통나무 파워 <b>${mk(usedPower)}</b></div>`:''}
                        ${(netWon>=1) ? `<div style=\"margin-top:2px;color:#25ae66;font-size:12px;display:flex;justify-content:flex-end;gap:6px;\">획득 통나무 파워 <b>${mk(netWon)}</b></div>`:''}
                        ${(wonPower!=null && wonPower>=1) ? `<div style=\"margin-top:2px;color:#aaa;font-size:12px;display:flex;justify-content:flex-end;gap:6px;\">합계 통나무 파워 <b>${mk(wonPower)}</b></div>`:''}
                    </div>`;
            } catch (err) {
                container.style.display = 'block';
                container.innerHTML = `<div style=\"color:#f66;font-size:12px;\">상세 정보를 불러오지 못했습니다. 치지직 라이브 탭을 하나 열어둔 뒤 다시 시도해주세요.<br>(${err && err.message ? err.message : err})</div>`;
            }
        });
    });
}

// 방식별 클래스 반환
function getMethodClass(method) {
    method = method.toLowerCase();
    switch (method) {
        case 'follow': return 'method-follow';
        case 'view': return 'method-view';
        case 'remember': return 'method-remember';
        case 'prediction': return 'method-prediction';
        default: return method;
    }
}

// 방식별 텍스트 반환
function getMethodText(method) {
    method = method.toLowerCase();
    switch (method) {
        case 'follow': return '팔로우';
        case 'view': return '시청';
        case 'remember': return '기억';
        case 'prediction': return '승부예측';
        default: return '기타';
    }
}

// 필터 설정
function setupFilters() {
    const methodFilter = document.getElementById('methodFilter');
    const channelFilter = document.getElementById('channelFilter');
    const dateFilter = document.getElementById('dateFilter');
    
    methodFilter.addEventListener('change', applyFilters);
    channelFilter.addEventListener('input', applyFilters);
    dateFilter.addEventListener('change', applyFilters);
}

// 필터 적용
function applyFilters() {
    const methodFilter = document.getElementById('methodFilter').value;
    const channelFilter = document.getElementById('channelFilter').value.toLowerCase();
    const dateFilter = document.getElementById('dateFilter').value;
    
    filteredLogs = allLogs.filter(log => {
        // 방식 필터 (OTHERS는 VIEW/FOLLOW 이외 모두 포함)
        if (methodFilter) {
            const method = String(log.method || '').toUpperCase();
            const filter = String(methodFilter).toUpperCase();
            if (filter === 'OTHERS') {
                if (method === 'VIEW' || method === 'FOLLOW') {
                    return false;
                }
            } else if (method !== filter) {
                return false;
            }
        }
        
        // 채널명 필터
        if (channelFilter && !log.channelName.toLowerCase().includes(channelFilter)) {
            return false;
        }
        
        // 날짜 필터
        if (dateFilter) {
            const logDate = new Date(log.timestamp);
            const now = new Date();
            
            switch (dateFilter) {
                case 'today':
                    if (logDate.toDateString() !== now.toDateString()) {
                        return false;
                    }
                    break;
                case 'week':
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    if (logDate < weekAgo) {
                        return false;
                    }
                    break;
                case 'month':
                    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    if (logDate < monthAgo) {
                        return false;
                    }
                    break;
            }
        }
        
        return true;
    });
    
    renderLogs();
}

// 개별 로그 삭제
async function deleteLog(filteredIndex) {
    const log = filteredLogs[filteredIndex];
    const ok = await showConfirm(`"${log.channelName}"에서 획득한 ${log.method} 로그를 삭제하시겠습니까?`, { title: '로그 삭제', okText: '삭제', cancelText: '취소', destructive: true });
    if (ok) {
        try {
            // 전체 로그에서 해당 로그 찾아서 삭제
            const allIndex = allLogs.findIndex(l => 
                l.timestamp === log.timestamp && 
                l.channelId === log.channelId && 
                l.amount === log.amount
            );
            
            if (allIndex !== -1) {
                allLogs.splice(allIndex, 1);
                await chrome.storage.local.set({ powerLogs: allLogs });
                
                // 필터링된 로그도 업데이트
                applyFilters();
                updateStats();
                renderLogs();
                
                showToast('로그가 삭제되었습니다.', 'success');
            }
        } catch (error) {
            console.error('로그 삭제 실패:', error);
            showToast('로그 삭제에 실패했습니다.', 'error');
        }
    }
}

// 개별 로그 편집
function editLog(filteredIndex) {
    const log = filteredLogs[filteredIndex];
    
    // 편집 폼 생성
    const editForm = `
        <div class="edit-modal-overlay" id="editModalOverlay">
            <div class="edit-modal" id="editModal">
                <div class="edit-modal-header">
                    <h3>로그 수정</h3>
                    <button class="close-btn" id="closeEditModal">×</button>
                </div>
                <div class="edit-modal-content">
                    <div class="form-group">
                        <label>채널명:</label>
                        <input type="text" id="editChannelName" value="${log.channelName}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>통나무 파워:</label>
                        <input type="number" id="editAmount" value="${log.amount}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>획득 방식:</label>
                        ${(() => {
                            const methodRaw = String(log.method || '').trim();
                            const methodUpper = methodRaw.toUpperCase();
                            const known = ['VIEW','FOLLOW', 'PREDICTION', 'OTHERS'];
                            const hasUnknown = methodUpper && !known.includes(methodUpper);
                            return `
                                <select id="editMethod" class="form-input">
                                    ${hasUnknown ? `<option value="Remember" selected>기억</option>` : ''}
                                    <option value="VIEW" ${methodUpper === 'VIEW' ? 'selected' : ''}>시청</option>
                                    <option value="FOLLOW" ${methodUpper === 'FOLLOW' ? 'selected' : ''}>팔로우</option>
                                    <option value="PREDICTION" ${methodUpper === 'PREDICTION' ? 'selected' : ''}>승부예측</option>
                                    <option value="OTHERS" ${methodUpper === 'OTHERS' ? 'selected' : ''}>기타</option>
                                </select>
                            `;
                        })()}
                    </div>
                    <div class="form-group">
                        <label>날짜/시간:</label>
                        <input type="datetime-local" id="editTimestamp" value="${new Date(new Date(log.timestamp).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19)}" class="form-input" step="1">
                    </div>
                    <div class="form-group" id="editPredictionGroup" style="display:${String(log.method||'').toUpperCase()==='PREDICTION' ? 'block' : 'none'};">
                        <label>predictionId:</label>
                        <input type="text" id="editPredictionId" value="${log.predictionId || ''}" class="form-input">
                    </div>
                </div>
                <div class="edit-modal-footer">
                    <button class="cancel-btn" id="cancelEditModal">취소</button>
                    <button class="save-btn" id="saveEditModal" data-log-index="${filteredIndex}">저장</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', editForm);
    
    // 모달 이벤트 리스너 추가
    addModalEventListeners();
}

// 모달 이벤트 리스너 추가
function addModalEventListeners() {
    // 모달 오버레이 클릭 시 닫기
    const overlay = document.getElementById('editModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeEditModal();
            }
        });
    }
    
    // 모달 내부 클릭 시 이벤트 전파 중지
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // 닫기 버튼
    const closeBtn = document.getElementById('closeEditModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEditModal);
    }
    
    // 취소 버튼
    const cancelBtn = document.getElementById('cancelEditModal');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeEditModal);
    }
    
    // 저장 버튼
    const saveBtn = document.getElementById('saveEditModal');
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            const logIndex = parseInt(e.target.getAttribute('data-log-index'));
            saveLogEdit(logIndex);
        });
    }

    // 방식 변경 시 predictionId 입력 토글
    const methodSel = document.getElementById('editMethod');
    if (methodSel) {
        methodSel.addEventListener('change', () => {
            const grp = document.getElementById('editPredictionGroup');
            if (!grp) return;
            const v = String(methodSel.value || '').toUpperCase();
            grp.style.display = v === 'PREDICTION' ? 'block' : 'none';
        });
    }
}

// 편집 모달 닫기
function closeEditModal() {
    const modal = document.querySelector('.edit-modal-overlay');
    if (modal) {
        modal.remove();
    }
}

// 테스트 로그 추가 모달
function openTestLogModal(baseIndex) {
    const base = {
        channelName: 'We Remember You',
        channelId: 'f722959d1b8e651bd56209b343932c01',
        amount: 6459220000,
        method: 'Remember',
        channelImageUrl: 'https://ssl.pstatic.net/cmstatic/nng/img/img_anonymous_square_gray_opacity2x.png?type=f120_120_na',
        timestamp: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString()
    };
    const nowLocal = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const form = `
        <div class="edit-modal-overlay" id="testModalOverlay">
            <div class="edit-modal" id="testModal">
                <div class="edit-modal-header">
                    <h3>테스트 로그 추가</h3>
                    <button class="close-btn" id="closeTestModal">×</button>
                </div>
                <div class="edit-modal-content">
                    <div class="form-group">
                        <label>Channel Name:</label>
                        <input type="text" id="testChannelName" value="${base.channelName || ''}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Channel ID:</label>
                        <input type="text" id="testChannelId" value="${base.channelId || ''}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Log Power:</label>
                        <input type="number" id="testAmount" value="${typeof base.amount === 'number' ? base.amount : 1}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>method:</label>
                        <input type="text" id="testMethod" value="${base.method || 'view'}" class="form-input">
                    </div>
                    <div class="form-group" id="testPredictionGroup" style="display:none;">
                        <label>predictionId:</label>
                        <input type="text" id="testPredictionId" value="" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Image URL:</label>
                        <input type="text" id="testImageUrl" value="${base.channelImageUrl || ''}" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Date:</label>
                        <input type="datetime-local" id="testTimestamp" value="${nowLocal}" class="form-input" step="1">
                    </div>
                </div>
                <div class="edit-modal-footer">
                    <button class="cancel-btn" id="cancelTestModal">취소</button>
                    <button class="save-btn" id="saveTestModal">추가</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', form);
    // 이벤트
    const overlay = document.getElementById('testModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTestModal(); });
    }
    const modal = document.getElementById('testModal');
    if (modal) modal.addEventListener('click', (e) => e.stopPropagation());
    const closeBtn = document.getElementById('closeTestModal');
    if (closeBtn) closeBtn.addEventListener('click', closeTestModal);
    const cancelBtn = document.getElementById('cancelTestModal');
    if (cancelBtn) cancelBtn.addEventListener('click', closeTestModal);
    const saveBtn = document.getElementById('saveTestModal');
    if (saveBtn) saveBtn.addEventListener('click', saveTestLog);
    const methodInput = document.getElementById('testMethod');
    if (methodInput) {
        methodInput.addEventListener('input', () => {
            const grp = document.getElementById('testPredictionGroup');
            if (!grp) return;
            const v = String(methodInput.value || '').toUpperCase();
            grp.style.display = v === 'PREDICTION' ? 'block' : 'none';
        });
        methodInput.dispatchEvent(new Event('input'));
    }
}

function closeTestModal() {
    const modal = document.getElementById('testModalOverlay');
    if (modal) modal.remove();
}

async function saveTestLog() {
    try {
        const channelName = document.getElementById('testChannelName').value.trim();
        const channelId = document.getElementById('testChannelId').value.trim();
        const amount = parseInt(document.getElementById('testAmount').value);
        const method = document.getElementById('testMethod').value.trim();
        const imageUrl = document.getElementById('testImageUrl').value.trim();
        const localValue = document.getElementById('testTimestamp').value; // local time
        const isoTimestamp = new Date(localValue).toISOString();

        if (!channelName || !channelId || !amount || !method) {
            showToast('필수 값을 입력하세요.', 'error');
            return;
        }

        const newLog = {
            channelName,
            channelId,
            amount,
            method,
            channelImageUrl: imageUrl,
            timestamp: isoTimestamp
        };
        if (String(method).toUpperCase() === 'PREDICTION') {
            const pid = (document.getElementById('testPredictionId')?.value || '').trim();
            if (pid) newLog.predictionId = pid;
        }

        // 앞쪽에 추가
        allLogs.unshift(newLog);
        await chrome.storage.local.set({ powerLogs: allLogs });
        applyFilters();
        updateStats();
        renderLogs();
        closeTestModal();
        showToast('테스트 로그가 추가되었습니다.', 'success');
    } catch (e) {
        console.error(e);
        showToast('테스트 로그 추가 실패', 'error');
    }
}

// 로그 편집 저장
async function saveLogEdit(filteredIndex) {
    try {
        const log = filteredLogs[filteredIndex];
        const newChannelName = document.getElementById('editChannelName').value.trim();
        const newAmount = parseInt(document.getElementById('editAmount').value);
        const newMethod = document.getElementById('editMethod').value.trim(); // VIEW | FOLLOW | PREDICTION | OTHERS
        const newTimestamp = new Date(document.getElementById('editTimestamp').value).toISOString();
        const newPredictionId = document.getElementById('editPredictionId') ? document.getElementById('editPredictionId').value.trim() : '';
        
        if (!newChannelName || !newAmount || !newMethod) {
            showToast('모든 필드를 입력해주세요.', 'error');
            return;
        }
        
        // 전체 로그에서 해당 로그 찾아서 수정
        const allIndex = allLogs.findIndex(l => 
            l.timestamp === log.timestamp && 
            l.channelId === log.channelId && 
            l.amount === log.amount
        );
        
        if (allIndex !== -1) {
            allLogs[allIndex] = {
                ...allLogs[allIndex],
                channelName: newChannelName,
                amount: newAmount,
                method: newMethod,
                timestamp: newTimestamp,
                ...(String(newMethod).toUpperCase()==='PREDICTION' ? { predictionId: newPredictionId } : { predictionId: undefined })
            };
            
            await chrome.storage.local.set({ powerLogs: allLogs });
            
            // 필터링된 로그도 업데이트
            applyFilters();
            updateStats();
            renderLogs();
            closeEditModal();
            showToast('로그가 수정되었습니다.', 'success');
        }
    } catch (error) {
        console.error('로그 수정 실패:', error);
        showToast('로그 수정에 실패했습니다.', 'error');
    }
}

// 모든 로그 삭제
async function clearAllLogs() {
    const ok = await showConfirm('모든 로그를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', { title: '모든 로그 삭제', okText: '삭제', cancelText: '취소', destructive: true });
    if (ok) {
        try {
            await chrome.storage.local.remove(['powerLogs']);
            allLogs = [];
            filteredLogs = [];
            updateStats();
            renderLogs();
            showToast('모든 로그가 삭제되었습니다.', 'success');
        } catch (error) {
            console.error('로그 삭제 실패:', error);
            showToast('로그 삭제에 실패했습니다.', 'error');
        }
    }
}

// Import/Export 기능 설정
function setupImportExport() {
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportLogs);
    }

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            importFile.click();
        });
    }

    if (importFile) {
        importFile.addEventListener('change', handleImportFile);
    }
}

// 로그 내보내기
function exportLogs() {
    try {
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            logs: allLogs
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `chzzk_power_logs_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`로그 ${allLogs.length}개가 내보내기되었습니다.`, 'success');
    } catch (error) {
        console.error('로그 내보내기 실패:', error);
        showToast('로그 내보내기에 실패했습니다.', 'error');
    }
}

// 파일 가져오기 처리
function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            // 데이터 유효성 검사
            if (!importData.logs || !Array.isArray(importData.logs)) {
                throw new Error('잘못된 파일 형식입니다.');
            }

            // 기존 로그와 병합할지 확인
            if (allLogs.length > 0) {
                const shouldOverwrite = confirm(
                    `현재 ${allLogs.length}개의 로그가 있습니다.\n` +
                    `가져올 로그: ${importData.logs.length}개\n\n` +
                    `확인하면 기존 로그를 모두 덮어쓰고 새 로그로 교체합니다.\n` +
                    `취소하면 가져오기를 취소합니다.`
                );

                if (!shouldOverwrite) {
                    showToast('가져오기가 취소되었습니다.', 'info');
                    return;
                }
            }

            allLogs = importData.logs;

            // 로그 정렬 (최신순)
            allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // 저장소에 저장
            chrome.storage.local.set({ powerLogs: allLogs }, () => {
                if (chrome.runtime.lastError) {
                    throw new Error(chrome.runtime.lastError.message);
                }
                
                updateStats();
                renderLogs();
                showToast(`로그 ${importData.logs.length}개가 가져오기되었습니다.`, 'success');
            });

        } catch (error) {
            console.error('로그 가져오기 실패:', error);
            showToast(`로그 가져오기에 실패했습니다: ${error.message}`, 'error');
        }
    };

    reader.onerror = function() {
        showToast('파일 읽기에 실패했습니다.', 'error');
    };

    reader.readAsText(file);
    
    // 파일 입력 초기화
    event.target.value = '';
}
