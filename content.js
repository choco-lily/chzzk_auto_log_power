console.log('[치지직 통나무 파워 자동 획득] 확장 프로그램 실행됨');

let lastPowerNode = null;

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

// 스트리머 해시코드 추출
function getChannelIdFromUrl() {
  const match = window.location.pathname.match(/\/live\/([\w-]+)/);
  return match ? match[1] : null;
}

// log-power API에서 파워 개수 받아오기 및 갱신
let cachedPowerAmount = null;
async function fetchAndUpdatePowerAmount() {
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
    } else {
      console.log('[치지직 통나무 파워 자동 획득] 비활성화 된 채널');
    }
    // 파워 표시는 유지하되, 불투명도 50% 및 마우스 오버 안내 적용
    cachedPowerAmount = amount;
    updatePowerCountBadge(amount, true);
    if (typeof powerBadgeDomPoller !== 'undefined' && powerBadgeDomPoller) clearInterval(powerBadgeDomPoller);
    if (typeof powerCountInterval !== 'undefined' && powerCountInterval) clearInterval(powerCountInterval);
    return;
  }
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
    setTimeout(() => { fetchAndUpdatePowerAmount(); }, 300);
  } else {
    console.log('[치지직 통나무 파워 자동 획득] claims: 없음');
  }
}

// 파워 개수 표시/갱신 (isInactive: true면 불투명도 50% 및 안내)
function updatePowerCountBadge(amount = cachedPowerAmount, isInactive = false) {
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
  badge.style.cursor = 'default';
  badge.style.verticalAlign = 'middle';
  badge.style.opacity = isInactive ? '0.5' : '1';
  badge.innerHTML = `${POWER_ICON_SVG}<span style=\"margin-left:4px;vertical-align:middle;\">${amount !== null ? amount : '?'}</span>`;
  if (isInactive) {
    badge.onmouseenter = function() {
      let tooltip = document.createElement('div');
      tooltip.textContent = '통나무가 비활성화 된 채널입니다.';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '99999';
      tooltip.style.background = 'rgba(0,0,0,0.85)';
      tooltip.style.color = '#fff';
      tooltip.style.padding = '6px 14px';
      tooltip.style.borderRadius = '8px';
      tooltip.style.fontSize = '14px';
      tooltip.style.pointerEvents = 'none';
      tooltip.className = 'chzzk_power_inactive_tooltip';
      document.body.appendChild(tooltip);
      // 위에 표시
      const rect = badge.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.top = (rect.top - tooltip.offsetHeight - 8) + 'px';
      badge._chzzkTooltip = tooltip;
    };
    badge.onmouseleave = function() {
      if (badge._chzzkTooltip) {
        badge._chzzkTooltip.remove();
        badge._chzzkTooltip = null;
      }
    };
  }
  if (badgeTarget.tagName === 'BUTTON') {
    badgeTarget.parentNode.insertBefore(badge, badgeTarget.nextSibling);
  } else {
    badgeTarget.appendChild(badge);
  }
  lastPowerNode = badge;
}

// 2초마다 표시 유지 및 버튼 자동 클릭
let powerBadgeDomPoller = null;
function startPowerBadgeDomPoller() {
  if (powerBadgeDomPoller) clearInterval(powerBadgeDomPoller);
  powerBadgeDomPoller = setInterval(() => {
    updatePowerCountBadge();
    clickPowerButtonIfExists();
  }, 2000);
}

// 1분마다 파워 개수 갱신
let powerCountInterval = null;
function startPowerCountUpdater() {
  fetchAndUpdatePowerAmount();
  if (powerCountInterval) clearInterval(powerCountInterval);
  powerCountInterval = setInterval(fetchAndUpdatePowerAmount, 1 * 60 * 1000);
  startPowerBadgeDomPoller();
}

document.addEventListener('DOMContentLoaded', startPowerCountUpdater);
setTimeout(startPowerCountUpdater, 2000);

// 1초마다 url 변경 감지 및 갱신 (탭별 동작)
let prevUrl = location.href;
setInterval(() => {
  const currUrl = location.href;
  if (prevUrl !== currUrl) {
    prevUrl = currUrl;
    console.log('[치지직 통나무 파워 자동 획득] 감지: URL 변경(탭별), 전체 재시작');
    startPowerCountUpdater();
  }
}, 1000);

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
  if (btn && !btn.dataset.chzzkAutoClicked) {
    btn.click();
    btn.dataset.chzzkAutoClicked = 'true';
    console.log('[치지직 통나무 파워 자동 획득] 자동 클릭: live_chatting_power_button');
  }
} 