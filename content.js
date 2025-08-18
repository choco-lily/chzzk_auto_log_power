console.log('[치지직 통나무 파워 자동 획득] 확장 프로그램 실행됨');

let lastPowerNode = null;
let isChannelInactive = false; // 비활성화 상태 고정용

// 항상 활성 상태처럼 동작하게 하는 기능 (새롭게 구현)
(function alwaysActive() {
  // document 속성 오버라이드
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  } catch (e) {}
  try {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  } catch (e) {}
  try {
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
  } catch (e) {}
  try {
    document.hasFocus = () => true;
  } catch (e) {}
  // 이벤트 리스너 무시
  const blockedEvents = ["visibilitychange", "blur", "webkitvisibilitychange"];
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (blockedEvents.includes(type)) return;
    return origAddEventListener.call(this, type, listener, options);
  };
  // 즉시 한 번 visibilitychange 이벤트 발생시켜서 반영
  try {
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) {}
})();

// follow API 요청 감지 시 파워 갱신 및 claims 확인
let followPowerCheckTimer = null;
(function interceptFollowAPI() {
  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    let url = '';
    let method = 'GET';
    if (typeof input === 'string') {
      url = input;
      if (init && init.method) method = init.method.toUpperCase();
    } else if (input && input.url) {
      url = input.url;
      method = input.method ? input.method.toUpperCase() : 'GET';
    }
    if (
      url &&
      url.match(/\/service\/v1\/channels\/[\w-]+\/follow$/) &&
      method === 'POST'
    ) {
      console.log('[치지직 통나무 파워 자동 획득] 감지: follow POST 요청, 파워 갱신');
      if (followPowerCheckTimer) clearInterval(followPowerCheckTimer);
      let tryCount = 0;
      followPowerCheckTimer = setInterval(async () => {
        tryCount++;
        const channelId = getChannelIdFromUrl();
        if (!channelId) return;
        let amount = null;
        let claims = [];
        try {
          const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`, { credentials: 'include' });
          const data = await res.json();
          if (data && data.content) {
            if (typeof data.content.amount === 'number') {
              amount = data.content.amount;
            }
            if (Array.isArray(data.content.claims)) {
              claims = data.content.claims;
            }
          }
        } catch (e) {}
        console.log(`[치지직 통나무 파워 자동 획득] follow 감시: 시도 ${tryCount}, 파워=${amount}, claims=${claims.length}`);
        if (claims && claims.length > 0) {
          // claims가 있으면 먼저 모두 PUT 처리
          await Promise.all(claims.map(async (claim) => {
            const claimId = claim.claimId;
            const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
            try {
              await fetch(putUrl, { method: 'PUT', credentials: 'include' });
            } catch (e) {}
          }));
          // claims 처리 후 파워가 반영될 때까지 polling
          let finalAmount = null;
          for (let i = 0; i < 10; i++) {
            try {
              const res2 = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`, { credentials: 'include' });
              const data2 = await res2.json();
              if (data2 && data2.content && typeof data2.content.amount === 'number') {
                finalAmount = data2.content.amount;
                if (finalAmount > 0) break;
              }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 300));
          }
          clearInterval(followPowerCheckTimer);
          followPowerCheckTimer = null;
          fetchAndUpdatePowerAmount();
        } else if (amount !== null && amount >= 300) {
          clearInterval(followPowerCheckTimer);
          followPowerCheckTimer = null;
          fetchAndUpdatePowerAmount();
        }
      }, 300);
    }
    return origFetch.apply(this, arguments);
  };
})();

// 스트리머 해시코드 추출
function getChannelIdFromUrl() {
  const match = window.location.pathname.match(/\/live\/([\w-]+)/);
  return match ? match[1] : null;
}

// log-power API에서 파워 개수 받아오기 및 갱신
let cachedPowerAmount = null;
async function fetchAndUpdatePowerAmount() {
  if (!isLivePage()) return;
  const channelId = getChannelIdFromUrl();
  if (!channelId) return;
  let amount = null;
  let claims = [];
  let now = new Date();
  let active = true;
  try {
    const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`, { credentials: 'include' });
    const data = await res.json();
    if (data && data.content) {
      if (typeof data.content.amount === 'number') {
        amount = data.content.amount;
      }
      if (Array.isArray(data.content.claims)) {
        claims = data.content.claims;
      }
      if (typeof data.content.active === 'boolean') {
        active = data.content.active;
      }
    }
  } catch (e) {
    amount = null;
    claims = [];
    active = true;
  }
  if (active === false) {
    isChannelInactive = true; // 비활성화 상태 고정
    if (claims.length > 0) {
      console.log('[치지직 통나무 파워 자동 획득] active=false, claims 1회만 자동 획득');
      await Promise.all(claims.map(async (claim) => {
        const claimId = claim.claimId;
        const claimType = claim.claimType;
        const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
        try {
          const putRes = await fetch(putUrl, { method: 'PUT', credentials: 'include' });
          const putJson = await putRes.json();
          const amountText = putJson.content && typeof putJson.content.amount === 'number' ? putJson.content.amount : '?';
          console.log(`[치지직 통나무 파워 자동 획득] ${claimType}으로 ${amountText}개 획득`);
        } catch (e) {
          console.log('[치지직 통나무 파워 자동 획득] PUT 요청 에러:', e);
        }
      }));
      setTimeout(() => { fetchAndUpdatePowerAmount(); }, 300);
    } else {
      console.log('[치지직 통나무 파워 자동 획득] 비활성화 된 채널');
    }
    cachedPowerAmount = amount;
    // 4초간 badge 표시 반복 갱신
    let inactiveBadgeTries = 0;
    const inactiveBadgeTimer = setInterval(() => {
      updatePowerCountBadge(amount, true);
      inactiveBadgeTries++;
      if (inactiveBadgeTries > 4) {
        clearInterval(inactiveBadgeTimer);
      }
    }, 300);
    if (typeof powerBadgeDomPoller !== 'undefined' && powerBadgeDomPoller) clearInterval(powerBadgeDomPoller);
    if (typeof powerCountInterval !== 'undefined' && powerCountInterval) clearInterval(powerCountInterval);
    return;
  }
  isChannelInactive = false; // 활성화 상태로 복귀 시 해제
  cachedPowerAmount = amount;
  updatePowerCountBadge(amount, false);
  console.log(`[치지직 통나무 파워 자동 획득] 파워 개수: ${amount !== null ? amount : '?'} | 갱신됨: ${now.toLocaleString()}`);
  if (claims.length > 0) {
    console.log('[치지직 통나무 파워 자동 획득] claims:', claims);
    await Promise.all(claims.map(async (claim) => {
      const claimId = claim.claimId;
      const claimType = claim.claimType;
      const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
      try {
        const putRes = await fetch(putUrl, { method: 'PUT', credentials: 'include' });
        const putJson = await putRes.json();
        const amountText = putJson.content && typeof putJson.content.amount === 'number' ? putJson.content.amount : '?';
        console.log(`[치지직 통나무 파워 자동 획득] ${claimType}으로 ${amountText}개 획득`);
      } catch (e) {
        console.log('[치지직 통나무 파워 자동 획득] PUT 요청 에러:', e);
      }
    }));
    // claims 획득 후 파워 표시 즉시 갱신
    setTimeout(() => { fetchAndUpdatePowerAmount(); }, 300);
  } else {
    console.log('[치지직 통나무 파워 자동 획득] claims: 없음');
  }
}

// 스타일 삽입 (최초 1회)
(function injectTooltipStyle() {
  if (document.getElementById('chzzk_power_inactive_tooltip_style')) return;
  const style = document.createElement('style');
  style.id = 'chzzk_power_inactive_tooltip_style';
  style.textContent = `
    .log_disabled_tooltip {
      align-items: center;
      background-color: var(--color-bg-04, #2e3033);
      border: 1px solid #0008;
      border-radius: 6px;
      bottom: 0;
      box-shadow: 1px 1px 3px #0008;
      color: var(--color-content-02, #dfe2ea);
      display: none;
      font-size: 12px;
      font-weight: 400;
      justify-content: center;
      line-height: 1.5;
      padding: 5px 9px;
      pointer-events: none;
      position: absolute;
      right: 30px;
      text-align: left;
      white-space: nowrap;
      z-index: 1000;
    }
    .chzzk_power_inactive_btn:hover .log_disabled_tooltip {
      display: inline-flex;
    }
  `;
  document.head.appendChild(style);
})();

// 파워 개수 표시/갱신 (isInactive: true면 불투명도 50% 및 안내)
function updatePowerCountBadge(amount = cachedPowerAmount, isInactive = false) {
  if (!isLivePage()) return;
  // 비활성화 상태 고정 시 무조건 비활성화 뱃지
  if (isChannelInactive) isInactive = true;
  const toolsDivs = Array.from(document.querySelectorAll('div')).filter(div => Array.from(div.classList).some(cls => cls.startsWith('live_chatting_input_tools__')));
  let badgeTarget = null;
  let donationBtn = null;
  for (const toolsDiv of toolsDivs) {
    const btns = Array.from(toolsDiv.querySelectorAll('button'));
    const donationBtns = btns.filter(b => Array.from(b.classList).some(cls => cls.startsWith('live_chatting_input_donation_button__')));
    if (donationBtns.length > 0) {
      donationBtn = donationBtns[donationBtns.length - 1];
      badgeTarget = donationBtn;
      break;
    } else {
      const actionDivs = Array.from(toolsDiv.querySelectorAll('div')).filter(div => Array.from(div.classList).some(cls => cls.startsWith('live_chatting_input_action__')));
      if (actionDivs.length > 0) {
        badgeTarget = actionDivs[actionDivs.length - 1];
        break;
      }
    }
  }
  if (!badgeTarget) return;
  if (lastPowerNode && lastPowerNode.parentNode) {
    lastPowerNode.parentNode.removeChild(lastPowerNode);
    lastPowerNode = null;
  }
  // 파워 개수 표시 생성 및 삽입
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.setAttribute('tabindex', '-1');
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.justifyContent = 'center';
  badge.style.height = donationBtn ? getComputedStyle(donationBtn).height : '28px';
  badge.style.minWidth = donationBtn ? getComputedStyle(donationBtn).minWidth : '28px';
  badge.style.background = 'none';
  badge.style.border = 'none';
  badge.style.padding = donationBtn ? getComputedStyle(donationBtn).padding : '0 8px';
  badge.style.marginLeft = '8px';
  badge.style.fontFamily = donationBtn ? getComputedStyle(donationBtn).fontFamily : 'inherit';
  badge.style.fontWeight = 'bold';
  badge.style.fontSize = donationBtn ? getComputedStyle(donationBtn).fontSize : '14px';
  badge.style.color = donationBtn ? getComputedStyle(donationBtn).color : '#fff';
  badge.style.cursor = 'pointer';
  badge.addEventListener('mouseenter', () => {
    badge.style.cursor = 'pointer';
    badge.style.background = 'rgba(255,255,255,0.08)';
  });
  badge.addEventListener('mouseleave', () => {
    badge.style.cursor = 'pointer';
    badge.style.background = 'none';
  });
  badge.innerHTML = `${POWER_ICON_SVG}<span style=\"margin-left:4px;vertical-align:middle;\">${amount !== null ? amount : '?'}</span>`;
  if (isInactive) {
    badge.classList.add('chzzk_power_inactive_btn');
    // 아이콘 색상만 회색으로 변경 (fill까지)
    const svg = badge.querySelector('svg');
    if (svg) {
      svg.style.color = '#888';
      svg.setAttribute('fill', '#888');
    }
    // 안내 텍스트 div 생성 및 log_disabled_tooltip 클래스 적용
    const tooltip = document.createElement('div');
    tooltip.textContent = '통나무가 비활성화 된 채널입니다.';
    tooltip.className = 'log_disabled_tooltip';
    badge.appendChild(tooltip);
  }
  badge.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    const existPopup = document.querySelector('.live_chatting_popup_donation_layer__sQ9nX');
    if (existPopup) {
      existPopup.parentNode && existPopup.parentNode.removeChild(existPopup);
      window.removeEventListener('keydown', escHandler);
      return;
    }

    // 채팅 리스트 wrapper 찾기
    const chatWrapper = document.querySelector('div[class^="live_chatting_list_wrapper__"]');
    if (!chatWrapper) return;

    // 팝업 레이어 (채팅 리스트 전체 덮음, 반응형)
    const popupLayer = document.createElement('div');
    popupLayer.className = 'live_chatting_popup_donation_layer__sQ9nX';
    popupLayer.setAttribute('role', 'dialog');
    popupLayer.style.position = 'absolute';
    popupLayer.style.left = '0';
    popupLayer.style.top = '0';
    popupLayer.style.width = '100%';
    popupLayer.style.height = '100%';
    popupLayer.style.display = 'flex';
    popupLayer.style.alignItems = 'center';
    popupLayer.style.justifyContent = 'center';
    popupLayer.style.zIndex = '20001';
    popupLayer.style.background = 'none';
    popupLayer.style.pointerEvents = 'none';

    // 팝업 컨테이너 (반응형, 내용 없음)
    const popupContainer = document.createElement('div');
    popupContainer.className = 'popup_container__Aqx-3 popup_none_shadow__jj3rb live_chatting_popup_donation_container__-Xbda';
    popupContainer.setAttribute('role', 'alertdialog');
    popupContainer.setAttribute('aria-modal', 'true');
    popupContainer.style.width = '92%';
    popupContainer.style.maxWidth = '486px';
    popupContainer.style.height = 'auto';
    popupContainer.style.minHeight = '150px';
    popupContainer.style.borderRadius = '12px';
    popupContainer.style.boxSizing = 'border-box';
    popupContainer.style.pointerEvents = 'auto';
    popupContainer.style.display = 'flex';
    popupContainer.style.flexDirection = 'column';
    popupContainer.style.alignItems = 'center';
    popupContainer.style.justifyContent = 'center';
    popupContainer.style.maxHeight = '100%';
    popupContainer.style.overflow = 'visible';
    popupContainer.innerHTML = '';

    // 닫기(X) 버튼
    const action = document.createElement('div');
    action.className = 'popup_action__KDxfm';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'button_container__ppWwB button_only_icon__kahz5 button_medium__PoMuw';
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('aria-label', '팝업 닫기');
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" d="M16.6 4.933A1.083 1.083 0 1 0 15.066 3.4L10 8.468 4.933 3.4A1.083 1.083 0 0 0 3.4 4.933L8.468 10 3.4 15.067A1.083 1.083 0 1 0 4.933 16.6L10 11.532l5.067 5.067a1.083 1.083 0 1 0 1.532-1.532L11.532 10l5.067-5.067Z"/></svg>`;
    closeBtn.onclick = removePopup;
    action.appendChild(closeBtn);
    popupContainer.appendChild(action);

    // 로딩 표시
    const loading = document.createElement('div');
    loading.style.padding = '32px 0';
    loading.style.fontSize = '18px';
    loading.style.color = '#fff';
    loading.textContent = '불러오는 중...';
    popupContainer.appendChild(loading);

    popupLayer.appendChild(popupContainer);
    chatWrapper.appendChild(popupLayer);

    // ESC로 닫기
    function removePopup() {
      if (popupLayer.parentNode) popupLayer.parentNode.removeChild(popupLayer);
      window.removeEventListener('keydown', escHandler);
    }
    function escHandler(ev) {
      if (ev.key === 'Escape') removePopup();
    }
    window.addEventListener('keydown', escHandler);

    // API 요청
    fetch('https://api.chzzk.naver.com/service/v1/log-power/balances', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        loading.remove();
        const arr = (data && data.content && data.content.data) ? data.content.data : [];
        // 100 이상만, amount 내림차순 정렬
        const filtered = arr.filter(x => x.amount >= 100).sort((a, b) => b.amount - a.amount);
        // HTML 테이블 생성
        const table = document.createElement('div');
        table.style.width = '100%';
        table.style.overflowY = 'auto';
        table.style.maxHeight = '400px';
        table.style.display = 'block';
        const defaultImg = 'https://ssl.pstatic.net/cmstatic/nng/img/img_anonymous_square_gray_opacity2x.png?type=f120_120_na';
        const totalPower = filtered.reduce((sum, x) => sum + x.amount, 0);
        table.innerHTML = `
          <div style="font-weight:bold;font-size:19px;margin-bottom:4px;">누적 파워: ${totalPower.toLocaleString()}</div>
          <div style="font-weight:bold;font-size:17px;margin-bottom:8px;">채널별 통나무 파워</div>
          <div style="color:#aaa;font-size:12px;margin-bottom:16px;">100 파워 이상 보유한 채널만 표시합니다.</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${filtered.map((x, i) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
                <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                  <span style="font-weight:bold;width:24px;text-align:right;color:#2a6aff;font-size:17px;">${i+1}</span>
                  <img src="${x.channelImageUrl ? x.channelImageUrl : defaultImg}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;background:#222;">
                  <span style="font-weight:bold;font-size:15px;white-space:normal;word-break:break-all;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;">${x.channelName}${x.verifiedMark ? ` <img src='https://ssl.pstatic.net/static/nng/glive/resource/p/static/media/icon_official.a53d1555f8f4796d7862.png' alt='인증' style='width:16px;height:16px;vertical-align:middle;margin-left:2px;'>` : ''}</span>
                </div>
                <span style="font-weight:bold;font-size:17px;letter-spacing:1px;">${x.amount.toLocaleString()}</span>
              </div>
            `).join('')}
          </div>
        `;
        popupContainer.appendChild(table);
      })
      .catch(err => {
        loading.remove();
        const errDiv = document.createElement('div');
        errDiv.style.color = '#f66';
        errDiv.style.fontSize = '16px';
        errDiv.style.padding = '32px 0';
        errDiv.textContent = 'API 요청 실패: ' + err;
        popupContainer.appendChild(errDiv);
      });
  }
  if (badgeTarget.tagName === 'BUTTON') {
    badgeTarget.parentNode.insertBefore(badge, badgeTarget.nextSibling);
  } else {
    badgeTarget.appendChild(badge);
  }
  lastPowerNode = badge;
}

// 1초마다 표시 유지 및 버튼 자동 클릭
let powerBadgeDomPoller = null;
function startPowerBadgeDomPoller() {
  if (!isLivePage()) return;
  if (powerBadgeDomPoller) clearInterval(powerBadgeDomPoller);
  powerBadgeDomPoller = setInterval(() => {
    updatePowerCountBadge();
    clickPowerButtonIfExists();
  }, 300);
}

// 1분마다 파워 개수 갱신
let powerCountInterval = null;
function startPowerCountUpdater() {
  if (!isLivePage()) return;
  fetchAndUpdatePowerAmount();
  if (powerCountInterval) clearInterval(powerCountInterval);
  powerCountInterval = setInterval(fetchAndUpdatePowerAmount, 1 * 60 * 1000);
  startPowerBadgeDomPoller();
}

document.addEventListener('DOMContentLoaded', startPowerCountUpdater);
setTimeout(startPowerCountUpdater, 2000);

function isLivePage() {
  return location.pathname.startsWith('/live');
}

// 1초마다 url 변경 감지 및 갱신 (chzzk.naver.com 전체에서 동작)
let prevUrl = location.href;
setInterval(() => {
  const currUrl = location.href;
  if (prevUrl !== currUrl) {
    prevUrl = currUrl;
    isChannelInactive = false; // URL 바뀌면 비활성화 상태 해제
    console.log('[치지직 통나무 파워 자동 획득] 감지: URL 변경(탭별), 전체 재시작');
    if (isLivePage()) {
      startPowerCountUpdater();
      // 비활성화 채널이어도 URL 바뀐 직후 1회는 무조건 파워 표시
      setTimeout(() => { updatePowerCountBadge(); }, 300);
    }
  }
}, 300);

// log-power 자동 획득 및 claims 처리
async function processLogPower(channelId) {
  const logPowerUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`;
  let data;
  try {
    const res = await fetch(logPowerUrl, { credentials: 'include' });
    data = await res.json();
  } catch (e) {
    console.log('[치지직 통나무 파워 자동 획득] log-power GET 요청 에러:', e);
    return;
  }
  let claims = [];
  if (data && data.content && Array.isArray(data.content.claims)) {
    claims = data.content.claims;
  }
  if (claims.length > 0) {
    console.log('[치지직 통나무 파워 자동 획득] log-power claims:', claims);
  } else {
    console.log('[치지직 통나무 파워 자동 획득] log-power claims: 없음');
  }
  if (claims.length > 0) {
    for (const claim of claims) {
      const claimId = claim.claimId;
      const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
      try {
        const putRes = await fetch(putUrl, { method: 'PUT', credentials: 'include' });
        const putJson = await putRes.json();
        console.log('[치지직 통나무 파워 자동 획득] PUT 응답:', putJson);
      } catch (e) {
        console.log('[치지직 통나무 파워 자동 획득] PUT 요청 에러:', e);
      }
    }
    try {
      const getRes = await fetch(logPowerUrl, { credentials: 'include' });
      const getJson = await getRes.json();
      console.log('[치지직 통나무 파워 자동 획득] log-power GET 재요청 응답:', getJson);
    } catch (e) {
      console.log('[치지직 통나무 파워 자동 획득] log-power GET 재요청 에러:', e);
    }
  }
}

// 파워 개수 표시용 SVG 아이콘
const POWER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><mask id="mask0_1071_43807" width="16" height="16" x="0" y="0" maskUnits="userSpaceOnUse" style="mask-type: alpha;"><path fill="currentColor" d="M6.795 2.434a.9.9 0 0 1 .74.388l.064.109 1.318 2.635H5.983l-.157-.313-.758-1.517a.9.9 0 0 1 .805-1.302h.922Z"></path><path fill="currentColor" fill-rule="evenodd" d="M12.148 4.434c.857 0 1.508.628 1.912 1.369.415.761.655 1.775.655 2.864 0 1.088-.24 2.102-.655 2.864-.404.74-1.055 1.369-1.912 1.369H4c-.857 0-1.508-.63-1.911-1.37-.416-.761-.655-1.775-.655-2.863 0-1.089.239-2.103.655-2.864.403-.74 1.054-1.37 1.911-1.37h8.148ZM4 5.566c-.248 0-.597.192-.917.779-.308.565-.517 1.385-.517 2.322 0 .936.209 1.756.517 2.321.32.587.67.779.917.779.248 0 .597-.192.917-.779.308-.565.517-1.385.517-2.321 0-.937-.209-1.757-.517-2.322-.32-.587-.67-.779-.917-.779Zm2.526 3.868a6.433 6.433 0 0 1-.222 1.132h5.363l.058-.002a.567.567 0 0 0 0-1.128l-.058-.002H6.526ZM6.284 6.7c.109.353.188.733.234 1.132h.815l.058-.002a.567.567 0 0 0 0-1.128l-.058-.002h-1.05Zm3.316 0a.567.567 0 1 0 0 1.132h3.923a4.83 4.83 0 0 0-.293-1.132H9.6Z" clip-rule="evenodd"></path><path fill="currentColor" d="M5.434 8.667c0-.937-.209-1.757-.517-2.322-.32-.587-.67-.779-.917-.779-.248 0-.597.192-.917.779-.308.565-.517 1.385-.517 2.322 0 .936.209 1.756.517 2.321.32.587.67.779.917.779.248 0 .597-.192.917-.779.308-.565.517-1.385.517-2.321Zm1.132 0c0 1.088-.239 2.102-.655 2.864C5.508 12.27 4.857 12.9 4 12.9s-1.508-.63-1.911-1.37c-.416-.761-.655-1.775-.655-2.863 0-1.089.239-2.103.655-2.864.403-.74 1.054-1.37 1.911-1.37s1.508.63 1.911 1.37c.416.761.655 1.775.655 2.864Z"></path><path fill="currentColor" d="M4.667 8.667C4.667 9.403 4.368 10 4 10c-.368 0-.667-.597-.667-1.333 0-.737.299-1.334.667-1.334.368 0 .667.597.667 1.334Z"></path></mask><g mask="url(#mask0_1071_43807)"><path fill="currentColor" d="M0 0h16v16H0z"></path></g></svg>`;

function clickPowerButtonIfExists() {
  const aside = document.querySelector('aside#aside-chatting');
  if (!aside) return;
  const btn = Array.from(aside.querySelectorAll('button')).find(
    b => Array.from(b.classList).some(cls => cls.startsWith('live_chatting_power_button__'))
  );
  if (btn) {
      btn.click();
      console.log('[치지직 통나무 파워 자동 획득] 자동 클릭: live_chatting_power_button');
      fetchAndUpdatePowerAmount();
  }
}

// 1초마다 badge 감시 및 복구
setInterval(() => {
  const badgeExists = document.querySelector('.chzzk_power_badge');
  if (!badgeExists) {
    updatePowerCountBadge();
  }
}, 300); 