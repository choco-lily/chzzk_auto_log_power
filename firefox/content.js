console.log("[치지직 통나무 파워 자동 획득] 확장 프로그램 실행됨");

let lastPowerNode = null;
let isChannelInactive = false; // 비활성화 상태 고정용
let followPowerCheckTimer = null;
let popupCreateRetryTimer = null; // 배지 클릭 시 팝업 생성 재시도 타이머
let popupLayerEscHandler = null; // 팝업 ESC 핸들러 참조 저장
let badgeToggle = false;
let clockToggle = false;
let lastViewLogTimestampMs = null; // 최근 view 로그 기록 시각 (메모리)
let lastClockNode = null; // 시계 UI 노드 참조

// 현재 테마가 다크인지 여부 (html 태그에 theme_dark 클래스 존재 여부)
function isDarkTheme() {
	try {
		return document.documentElement.classList.contains("theme_dark");
	} catch (e) {
		return true;
	}
}

// 테마별 색상 모음
function getThemeColors() {
	const dark = isDarkTheme();
	return {
		bg: dark ? "none" : "#fff",
		fg: dark ? "#fff" : "#000",
		hoverBg: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
		popupBg: dark ? "var(--Ref-Color-Neutral-90, #141517)" : "#fff",
		popupFg: dark ? "#fff" : "#000",
		border: "1px solid #0008",
		inactiveIcon: "#888",
	};
}

// 채널 정보 가져오기 함수
async function getChannelInfo(channelId) {
    try {
        const response = await fetch(
            `https://api.chzzk.naver.com/service/v1/channels/${channelId}`
        );
        const data = await response.json();

        if (data && data.content) {
            return {
                channelId: data.content.channelId,
                channelName: data.content.channelName,
                channelImageUrl: data.content.channelImageUrl,
                verifiedMark: data.content.verifiedMark,
            };
        }
    } catch (error) {
        console.error(
            "[치지직 통나무 파워 자동 획득] 채널 정보 가져오기 실패:",
            error
        );
    }

    return {
        channelId: channelId,
        channelName: "알 수 없는 채널",
        channelImageUrl: null,
        verifiedMark: false,
    };
}

// 통나무 획득 로그 저장 함수
async function savePowerLog(channelId, amount, method, testAmount = null) {
    try {
        // 채널 정보 가져오기
        const channelInfo = await getChannelInfo(channelId);

        const logEntry = {
            timestamp: new Date().toISOString(),
            channelId: channelInfo.channelId,
            channelName: channelInfo.channelName,
            channelImageUrl: channelInfo.channelImageUrl,
            verifiedMark: channelInfo.verifiedMark,
            amount: amount,
            method: method, // 'follow', 'view', 'claimType' 등
        };

        if (testAmount !== null) {
            if (method.toUpperCase() == "FOLLOW") {
                return;
            }
            logEntry.channelName = logEntry.channelName + " (테스트) - " + logEntry.method + " - " + testAmount;
        }

        // 기존 로그 가져오기
        const result = await browser.storage.local.get(["powerLogs"]);
        const logs = result.powerLogs || [];

        // 새 로그 추가 (최대 1000개까지만 저장)
        logs.unshift(logEntry);
        if (logs.length > 1000) {
            logs.splice(1000);
        }

        // 저장
        await browser.storage.local.set({ powerLogs: logs });
        console.log("[치지직 통나무 파워 자동 획득] 로그 저장됨:", logEntry);
    } catch (error) {
        console.error("[치지직 통나무 파워 자동 획득] 로그 저장 실패:", error);
    }
}

browser.storage.sync.get(["badge", "clockToggle"]).then((r) => {
    if (r.badge == undefined) {
        r.badge = true;
        browser.storage.sync.set({ badge: true });
    }
    if (r.clockToggle == undefined) {
        r.clockToggle = false;
        browser.storage.sync.set({ clockToggle: false });
    }
    badgeToggle = r.badge;
    clockToggle = r.clockToggle;
}).catch((error) => {
    console.error("Storage sync get error:", error);
    badgeToggle = true; // 기본값 설정
    clockToggle = false; // 기본값 설정
});

// popup에서 오는 메시지 리스너
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateBadgeToggle") {
        badgeToggle = request.badgeToggle;
        // 즉시 뱃지 상태 업데이트
        if (lastPowerNode && lastPowerNode.parentNode) {
            lastPowerNode.style.display = badgeToggle ? "inline-flex" : "none";
        } else if (badgeToggle) {
            // 뱃지가 없고 badgeToggle이 true인 경우 생성
            updatePowerCountBadge();
        }
    } else if (request.action === "updateClockToggle") {
        clockToggle = request.clockToggle;
        // 즉시 시계 상태 업데이트
        if (lastClockNode && lastClockNode.parentNode) {
            lastClockNode.style.display = clockToggle ? "inline-flex" : "none";
        } else if (clockToggle) {
            // 시계가 없고 clockToggle이 true인 경우 생성
            updateClockDisplay();
        }
    }
});

(function alwaysActive() {
    // document 속성 오버라이드
    try {
        Object.defineProperty(document, "hidden", {
            get: () => false,
            configurable: true,
        });
    } catch (e) {}
    try {
        Object.defineProperty(document, "visibilityState", {
            get: () => "visible",
            configurable: true,
        });
    } catch (e) {}
    try {
        Object.defineProperty(document, "webkitVisibilityState", {
            get: () => "visible",
            configurable: true,
        });
    } catch (e) {}
    try {
        document.hasFocus = () => true;
    } catch (e) {}
    // 이벤트 리스너 무시
    const blockedEvents = [
        "visibilitychange",
        "blur",
        "webkitvisibilitychange",
    ];
    const origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
        type,
        listener,
        options
    ) {
        if (blockedEvents.includes(type)) return;
        return origAddEventListener.call(this, type, listener, options);
    };
    // 즉시 한 번 visibilitychange 이벤트 발생시켜서 반영
    try {
        document.dispatchEvent(new Event("visibilitychange"));
    } catch (e) {}
})();

// PerformanceObserver 기반 네트워크 감지
(function observeNetworkByPerformance() {
    const followRe = /\/service\/v1\/channels\/[\w-]+\/follow(?:[\/?#].*)?$/; // 쿼리/슬래시 허용
    function handleUrl(url) {
        if (!url) return;
        if (!followRe.test(url)) return;
        console.log(
            "[치지직 통나무 파워 자동 획득] 감지: follow",
            url
        );
        if (!followPowerCheckTimer) {
            let tryCount = 0;
            followPowerCheckTimer = setInterval(async () => {
                tryCount++;
                const channelId = getChannelIdFromUrl();
                if (!channelId) return;
                let amount = null;
                let claims = [];
                try {
                    const res = await fetch(
                        `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`,
                        { credentials: "include" }
                    );
                    const data = await res.json();
                    if (data && data.content) {
                        if (typeof data.content.amount === "number")
                            amount = data.content.amount;
                        if (Array.isArray(data.content.claims))
                            claims = data.content.claims;
                    }
                } catch (e) {}
                if (claims && claims.length > 0) {
                    console.log("[치지직 통나무 파워 자동 획득] claims:", claims);
                    await Promise.all(
                        claims.map(async (claim) => {
                            const claimId = claim.claimId;
                            const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
                            try {
                                await fetch(putUrl, {
                                    method: "PUT",
                                    credentials: "include",
                                });
                            } catch (e) {}
                            // 로그 저장
                            if (claim.claimType != "WATCH_1_HOUR") {
                                // 로그 저장
                                savePowerLog(channelId, claim.amount, claim.claimType);
                            }
                        })
                    );
                    for (let i = 0; i < 10; i++) {
                        try {
                            const res2 = await fetch(
                                `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`,
                                { credentials: "include" }
                            );
                            const data2 = await res2.json();
                            if (
                                data2 &&
                                data2.content &&
                                typeof data2.content.amount === "number"
                            ) {
                                amount = data2.content.amount;
                                if (amount > 0) break;
                            }
                        } catch (e) {}
                        await new Promise((r) => setTimeout(r, 1000));
                    }
                    clearInterval(followPowerCheckTimer);
                    followPowerCheckTimer = null;
                    fetchAndUpdatePowerAmount();
                } else if (amount !== null && amount >= 300) {
                    clearInterval(followPowerCheckTimer);
                    followPowerCheckTimer = null;
                    fetchAndUpdatePowerAmount();
                }
            }, 1000);
        }
    }
    try {
        const po = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                handleUrl(entry.name);
            }
        });
        po.observe({ type: "resource", buffered: true });
        performance
            .getEntriesByType("resource")
            .forEach((e) => handleUrl(e.name));
    } catch (e) {
        setInterval(() => {
            try {
                performance
                    .getEntriesByType("resource")
                    .forEach((e) => handleUrl(e.name));
            } catch (_) {}
        }, 1000);
    }
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
        const res = await fetch(
            `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power`,
            { credentials: "include" }
        );
        const data = await res.json();
        if (data && data.content) {
            if (typeof data.content.amount === "number") {
                amount = data.content.amount;
            }
            if (Array.isArray(data.content.claims)) {
                claims = data.content.claims;
            }
            if (typeof data.content.active === "boolean") {
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
            console.log(
                "[치지직 통나무 파워 자동 획득] claims:", claims
            );
            await Promise.all(
                claims.map(async (claim) => {
                    const claimId = claim.claimId;
                    const claimType = claim.claimType;
                    const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
                    try {
                        const putRes = await fetch(putUrl, {
                            method: "PUT",
                            credentials: "include",
                        });
                        const putJson = await putRes.json();
                        const amountText =
                            putJson.content &&
                            typeof putJson.content.amount === "number"
                                ? putJson.content.amount
                                : "?";
                        console.log(
                            `[치지직 통나무 파워 자동 획득] ${claimType}으로 ${amountText}개 획득`
                        );
                        if (claimType == "WATCH_1_HOUR") {
                            // 로그 저장
                            savePowerLog(channelId, 100, claimType);
                        }
                        else if (claimType == "FOLLOW") {
                            savePowerLog(channelId, 300, "FOLLOW");
                        } else {
                            savePowerLog(channelId, 0, claimType, amountText);
                        }
                    } catch (e) {
                        console.log(
                            "[치지직 통나무 파워 자동 획득] PUT 요청 에러:",
                            e
                        );
                    }
                })
            );
            setTimeout(() => {
                fetchAndUpdatePowerAmount();
            }, 1000);
        } else {
            console.log("[치지직 통나무 파워 자동 획득] 비활성화 된 채널");
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
        }, 1000);
        if (typeof powerBadgeDomPoller !== "undefined" && powerBadgeDomPoller)
            clearInterval(powerBadgeDomPoller);
        if (typeof powerCountInterval !== "undefined" && powerCountInterval)
            clearInterval(powerCountInterval);
        return;
    }
    isChannelInactive = false; // 활성화 상태로 복귀 시 해제
    cachedPowerAmount = amount;
    updatePowerCountBadge(amount, false);
    if (claims.length > 0) {
        console.log("[치지직 통나무 파워 자동 획득] claims:", claims);
        await Promise.all(
            claims.map(async (claim) => {
                const claimId = claim.claimId;
                const claimType = claim.claimType;
                const putUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}/log-power/claims/${claimId}`;
                try {
                    const putRes = await fetch(putUrl, {
                        method: "PUT",
                        credentials: "include",
                    });
                    const putJson = await putRes.json();
                    const amountText =
                        putJson.content &&
                        typeof putJson.content.amount === "number"
                            ? putJson.content.amount
                            : "?";
                    console.log(
                        `[치지직 통나무 파워 자동 획득] ${claimType}으로 ${amountText}개 획득`
                    );

                    if (claimType != "WATCH_1_HOUR") {
                        // 로그 저장
                        savePowerLog(channelId, 0, claimType, amountText);
                    }
                } catch (e) {
                    console.log(
                        "[치지직 통나무 파워 자동 획득] PUT 요청 에러:",
                        e
                    );
                }
            })
        );
        // claims 획득 후 파워 표시 즉시 갱신
        setTimeout(() => {
            fetchAndUpdatePowerAmount();
        }, 1000);
    }
}

// 스타일 삽입 (최초 1회)
(function injectTooltipStyle() {
    if (document.getElementById("chzzk_power_inactive_tooltip_style")) return;
    const style = document.createElement("style");
    style.id = "chzzk_power_inactive_tooltip_style";
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
    // badgeToggle 값 확인 후 항상 새로 생성
    browser.storage.sync.get("badge").then((r) => {
        if (r.badge == undefined) {
            r.badge = true;
            browser.storage.sync.set({ badge: true });
        }
        badgeToggle = r.badge;

        // 기존 뱃지 제거 (백업본처럼 항상 새로 생성)
        if (lastPowerNode && lastPowerNode.parentNode) {
            lastPowerNode.parentNode.removeChild(lastPowerNode);
            lastPowerNode = null;
        }

        // 토글이 꺼져 있으면 생성하지 않음
        if (!badgeToggle) return;

        // 새 뱃지 생성
        createPowerBadge(amount, isInactive);
    }).catch((error) => {
        console.error("Storage sync get error:", error);
        badgeToggle = true; // 기본값 설정
        // 기본값으로 뱃지 생성
        if (lastPowerNode && lastPowerNode.parentNode) {
            lastPowerNode.parentNode.removeChild(lastPowerNode);
            lastPowerNode = null;
        }
        createPowerBadge(amount, isInactive);
    });
}

// 뱃지 생성 함수
function createPowerBadge(amount, isInactive) {
    const toolsDivs = Array.from(document.querySelectorAll("div")).filter(
        (div) =>
            Array.from(div.classList).some((cls) =>
                cls.startsWith("live_chatting_input_tools__")
            )
    );
    let badgeTarget = null;
    let donationBtn = null;
    for (const toolsDiv of toolsDivs) {
        const btns = Array.from(toolsDiv.querySelectorAll("button"));
        const donationBtns = btns.filter((b) =>
            Array.from(b.classList).some((cls) =>
                cls.startsWith("live_chatting_input_donation_button__")
            )
        );
        if (donationBtns.length > 0) {
            donationBtn = donationBtns[donationBtns.length - 1];
            badgeTarget = donationBtn;
            break;
        } else {
            const actionDivs = Array.from(
                toolsDiv.querySelectorAll("div")
            ).filter((div) =>
                Array.from(div.classList).some((cls) =>
                    cls.startsWith("live_chatting_input_action__")
                )
            );
            if (actionDivs.length > 0) {
                badgeTarget = actionDivs[actionDivs.length - 1];
                break;
            }
        }
    }
    if (!badgeTarget) return;

    // 파워 개수 표시 생성 및 삽입
    const badge = document.createElement("button");
    badge.type = "button";
    badge.setAttribute("tabindex", "-1");
	badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.height = "24px";
    badge.style.minWidth = "24px";
	const colors = getThemeColors();
	badge.style.background = colors.bg;
    badge.style.border = "none";
    badge.style.padding = "0 2px";
    badge.style.marginLeft = "0px";
    badge.style.fontFamily = "inherit";
    badge.style.fontWeight = "bold";
    badge.style.fontSize = "11px";
	badge.style.color = colors.fg;
    badge.style.cursor = "pointer";
    badge.addEventListener("mouseenter", () => {
        badge.style.cursor = "pointer";
		badge.style.background = colors.hoverBg;
    });
    badge.addEventListener("mouseleave", () => {
        badge.style.cursor = "pointer";
		badge.style.background = colors.bg;
    });
    badge.innerHTML = `${POWER_ICON_SVG}<span style="margin-left:4px;vertical-align:middle;">${
		amount !== null ? amount : "?"
    }<\/span>`;
    badge.classList.add("chzzk_power_badge");
	// 라이트 모드에서 아이콘 색상은 텍스트 색상과 동기화
	const svg = badge.querySelector("svg");
	if (svg) {
		svg.style.color = colors.fg;
		svg.setAttribute("fill", "currentColor");
	}

    // 비활성화 상태 설정
	updateBadgeInactiveState(badge, isInactive);

    badge.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
		// 뱃지 클릭 시 즉시 파워 개수 갱신
		fetchAndUpdatePowerAmount();
        const existPopup = document.querySelector(
            ".chzzk_power_popup_layer, .live_chatting_popup_donation_layer__sQ9nX"
        );
        if (existPopup) {
            existPopup.parentNode &&
                existPopup.parentNode.removeChild(existPopup);
            if (popupLayerEscHandler) {
                window.removeEventListener("keydown", popupLayerEscHandler);
                popupLayerEscHandler = null;
            }
            if (popupCreateRetryTimer) {
                clearTimeout(popupCreateRetryTimer);
                popupCreateRetryTimer = null;
            }
            return;
        }

        // 재시도 기반 팝업 생성
        if (popupCreateRetryTimer) {
            clearTimeout(popupCreateRetryTimer);
            popupCreateRetryTimer = null;
        }
        (function tryCreatePopup() {
            // 채팅 리스트 wrapper 찾기 (없으면 생길 때까지 재시도)
            const chatWrapper = document.querySelector(
                'div[class^="live_chatting_list_wrapper"]'
            );
            if (!chatWrapper) {
                popupCreateRetryTimer = setTimeout(tryCreatePopup, 1000);
                return;
            }

            // 팝업 레이어 (채팅 리스트 전체 덮음, 반응형)
            const popupLayer = document.createElement("div");
            popupLayer.className = "chzzk_power_popup_layer";
            popupLayer.setAttribute("role", "dialog");
            popupLayer.style.position = "absolute";
            popupLayer.style.left = "0";
            popupLayer.style.top = "0";
            popupLayer.style.width = "100%";
            popupLayer.style.height = "100%";
            popupLayer.style.display = "flex";
            popupLayer.style.alignItems = "center";
            popupLayer.style.justifyContent = "center";
            popupLayer.style.zIndex = "20001";
            popupLayer.style.background = "none";
            popupLayer.style.pointerEvents = "none";

            // 팝업 컨테이너 (반응형, 내용 없음)
            const popupContainer = document.createElement("div");
            popupContainer.className = "chzzk_power_popup_container";
            popupContainer.setAttribute("role", "alertdialog");
            popupContainer.setAttribute("aria-modal", "true");
            popupContainer.style.width = "94%";
            popupContainer.style.maxWidth = "490px";
            popupContainer.style.height = "auto";
            popupContainer.style.minHeight = "150px";
            popupContainer.style.borderRadius = "12px";
            popupContainer.style.boxSizing = "border-box";
            popupContainer.style.pointerEvents = "auto";
            popupContainer.style.display = "flex";
            popupContainer.style.flexDirection = "column";
            popupContainer.style.alignItems = "center";
            popupContainer.style.justifyContent = "center";
            popupContainer.style.maxHeight = "100%";
            popupContainer.style.overflow = "visible";
			const colors2 = getThemeColors();
			popupContainer.style.background = colors2.popupBg;
			popupContainer.style.color = colors2.popupFg;
            popupContainer.style.border = "1px solid #0008";
            popupContainer.innerHTML = "";

            // 닫기(X) 버튼
            const action = document.createElement("div");
            action.className = "chzzk_power_popup_action";
            action.style.alignSelf = "stretch";
            action.style.display = "flex";
            action.style.justifyContent = "flex-end";
            action.style.width = "100%";
            action.style.padding = "8px";
            const closeBtn = document.createElement("button");
            closeBtn.className = "chzzk_power_popup_close_button";
            closeBtn.setAttribute("type", "button");
            closeBtn.setAttribute("aria-label", "팝업 닫기");
            closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" d="M16.6 4.933A1.083 1.083 0 1 0 15.066 3.4L10 8.468 4.933 3.4A1.083 1.083 0 0 0 3.4 4.933L8.468 10 3.4 15.067A1.083 1.083 0 1 0 4.933 16.6L10 11.532l5.067 5.067a1.083 1.083 0 1 0 1.532-1.532L11.532 10l5.067-5.067Z"/></svg>`;
            closeBtn.style.background = "none";
            closeBtn.style.border = "none";
			closeBtn.style.color = colors2.popupFg;
            closeBtn.style.width = "32px";
            closeBtn.style.height = "32px";
            closeBtn.style.display = "inline-flex";
            closeBtn.style.alignItems = "center";
            closeBtn.style.justifyContent = "center";
            closeBtn.style.borderRadius = "8px";
            closeBtn.style.cursor = "pointer";
			closeBtn.addEventListener("mouseenter", () => {
				closeBtn.style.background = colors2.hoverBg;
			});
            closeBtn.addEventListener("mouseleave", () => {
				closeBtn.style.background = colors2.bg;
            });

            // 로딩 표시
            const loading = document.createElement("div");
            loading.style.padding = "32px 0";
            loading.style.fontSize = "18px";
			loading.style.color = colors2.popupFg;
            loading.textContent = "불러오는 중...";

            closeBtn.onclick = removePopup;
            action.appendChild(closeBtn);
            popupContainer.appendChild(action);
            popupContainer.appendChild(loading);

            popupLayer.appendChild(popupContainer);
            chatWrapper.appendChild(popupLayer);

            // ESC로 닫기
            function removePopup() {
                if (popupLayer.parentNode)
                    popupLayer.parentNode.removeChild(popupLayer);
                if (popupLayerEscHandler) {
                    window.removeEventListener("keydown", popupLayerEscHandler);
                    popupLayerEscHandler = null;
                }
            }
            popupLayerEscHandler = function (ev) {
                if (ev.key === "Escape") removePopup();
            };
            window.addEventListener("keydown", popupLayerEscHandler);

            // API 요청
            fetch("https://api.chzzk.naver.com/service/v1/log-power/balances", {
                credentials: "include",
            })
                .then((res) => res.json())
                .then((data) => {
                    loading.remove();
                    const arr =
                        data && data.content && data.content.data
                            ? data.content.data
                            : [];
                    // 100 이상만, amount 내림차순 정렬
                    const filtered = arr
                        .filter((x) => x.amount >= 100)
                        .sort((a, b) => b.amount - a.amount);
                    // HTML 테이블 생성
                    const table = document.createElement("div");
                    table.style.width = "100%";
                    table.style.overflowY = "auto";
                    table.style.maxHeight = "400px";
                    table.style.display = "block";
                    const defaultImg =
                        "https://ssl.pstatic.net/cmstatic/nng/img/img_anonymous_square_gray_opacity2x.png?type=f120_120_na";
                    const totalPower = filtered.reduce(
                        (sum, x) => sum + x.amount,
                        0
                    );
                    table.innerHTML = `
            <div style="font-weight:bold;font-size:19px;margin-bottom:4px;">누적 파워: ${totalPower.toLocaleString()}</div>
            <div style="font-weight:bold;font-size:17px;margin-bottom:8px;">채널별 통나무 파워</div>
            <div style="color:#aaa;font-size:12px;margin-bottom:16px;">100 파워 이상 보유한 채널만 표시합니다.<br>비활성화 된 채널은 회색으로 표시됩니다.</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${filtered
                  .map(
                      (x, i) => `
                <div style=\"display:flex;align-items:center;justify-content:space-between;padding:4px 0;\">
                  <div style=\"display:flex;align-items:center;gap:12px;min-width:0;\">
                    <span style=\"font-weight:bold;width:24px;text-align:right;color:${
                        x.active ? "#2a6aff" : "#666"
                    };font-size:17px;\">${i + 1}</span>
                    <img src=\"${
                        x.channelImageUrl ? x.channelImageUrl : defaultImg
                    }\" alt=\"\" style=\"width:36px;height:36px;border-radius:50%;object-fit:cover;background:#222;opacity:${
                          x.active ? "1" : "0.5"
                      };\">
                    <span style=\"font-weight:bold;font-size:15px;white-space:normal;word-break:break-all;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;color:${
                        x.active ? "inherit" : "#666"
                    };\">${x.channelName}${
                          x.verifiedMark
                              ? ` <img src='https://ssl.pstatic.net/static/nng/glive/resource/p/static/media/icon_official.a53d1555f8f4796d7862.png' alt='인증' style='width:16px;height:16px;vertical-align:middle;margin-left:2px;'>`
                              : ""
                      }</span>
                  </div>
                  <span style=\"font-weight:bold;font-size:17px;letter-spacing:1px;color:${
                      x.active ? "inherit" : "#666"
                  };\">${x.amount.toLocaleString()}</span>
                </div>
              `
                  )
                  .join("")}
            </div>
          `;
                    popupContainer.appendChild(table);
                })
                .catch((err) => {
                    loading.remove();
                    const errDiv = document.createElement("div");
                    errDiv.style.color = "#f66";
                    errDiv.style.fontSize = "16px";
                    errDiv.style.padding = "32px 0";
                    errDiv.textContent = "API 요청 실패: " + err;
                    popupContainer.appendChild(errDiv);
                });

            // 성공적으로 생성되었으므로 재시도 타이머 해제
            if (popupCreateRetryTimer) {
                clearTimeout(popupCreateRetryTimer);
                popupCreateRetryTimer = null;
            }
        })();
    };

    if (badgeTarget.tagName === "BUTTON") {
        badgeTarget.parentNode.insertBefore(badge, badgeTarget.nextSibling);
    } else {
        badgeTarget.appendChild(badge);
    }
    lastPowerNode = badge;
}

// 뱃지 비활성화 상태 업데이트 함수
function updateBadgeInactiveState(badge, isInactive) {
    if (isInactive) {
        badge.classList.add("chzzk_power_inactive_btn");
        // 아이콘 색상만 회색으로 변경 (fill까지)
        const svg = badge.querySelector("svg");
        if (svg) {
            svg.style.color = "#888";
            svg.setAttribute("fill", "#888");
        }
        // 안내 텍스트 div가 없으면 생성
        if (!badge.querySelector(".log_disabled_tooltip")) {
            const tooltip = document.createElement("div");
            tooltip.textContent = "통나무가 비활성화 된 채널입니다.";
            tooltip.className = "log_disabled_tooltip";
            // 라이트 모드에서 툴팁 색상도 흰 배경/검은 글자로 보정
            const colors = getThemeColors();
            tooltip.style.backgroundColor = colors.bg === "none" ? "#2e3033" : "#fff";
            tooltip.style.color = colors.fg;
            tooltip.style.border = "1px solid #0008";
            badge.appendChild(tooltip);
        }
    } else {
        badge.classList.remove("chzzk_power_inactive_btn");
        // 아이콘 색상을 원래대로 복원
        const svg = badge.querySelector("svg");
        if (svg) {
            const colors = getThemeColors();
            svg.style.color = colors.fg; // currentColor에 맞춤
            svg.setAttribute("fill", "currentColor");
        }
        // 안내 텍스트 div 제거
        const tooltip = badge.querySelector(".log_disabled_tooltip");
        if (tooltip) {
            tooltip.remove();
        }
    }
}

// 1초마다 표시 유지 및 버튼 자동 클릭
let powerBadgeDomPoller = null;
function startPowerBadgeDomPoller() {
    if (!isLivePage()) return;
    if (powerBadgeDomPoller) clearInterval(powerBadgeDomPoller);
    powerBadgeDomPoller = setInterval(() => {
        updatePowerCountBadge();
        updateClockDisplay();
        clickPowerButtonIfExists();
    }, 1000);
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

document.addEventListener("DOMContentLoaded", startPowerCountUpdater);
setTimeout(startPowerCountUpdater, 2000);

function isLivePage() {
    return location.href.includes("/live");
}

// 1초마다 url 변경 감지 및 갱신 (chzzk.naver.com 전체에서 동작)
let prevUrl = location.href;
setInterval(() => {
    const currUrl = location.href;
    if (prevUrl !== currUrl) {
        prevUrl = currUrl;
        isChannelInactive = false; // URL 바뀌면 비활성화 상태 해제
        console.log(
            "[치지직 통나무 파워 자동 획득] 감지: URL 변경(탭별), 전체 재시작"
        );
        if (isLivePage()) {
            startPowerCountUpdater();
            // 비활성화 채널이어도 URL 바뀐 직후 1회는 무조건 파워 표시
            setTimeout(() => {
                updatePowerCountBadge();
            }, 1000);
        }
    }
}, 1000);

// 파워 개수 표시용 SVG 아이콘
const POWER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none"><mask id="mask0_1071_43807" width="16" height="16" x="0" y="0" maskUnits="userSpaceOnUse" style="mask-type: alpha;"><path fill="currentColor" d="M6.795 2.434a.9.9 0 0 1 .74.388l.064.109 1.318 2.635H5.983l-.157-.313-.758-1.517a.9.9 0 0 1 .805-1.302h.922Z"></path><path fill="currentColor" fill-rule="evenodd" d="M12.148 4.434c.857 0 1.508.628 1.912 1.369.415.761.655 1.775.655 2.864 0 1.088-.24 2.102-.655 2.864-.404.74-1.055 1.369-1.912 1.369H4c-.857 0-1.508-.63-1.911-1.37-.416-.761-.655-1.775-.655-2.863 0-1.089.239-2.103.655-2.864.403-.74 1.054-1.37 1.911-1.37h8.148ZM4 5.566c-.248 0-.597.192-.917.779-.308.565-.517 1.385-.517 2.322 0 .936.209 1.756.517 2.321.32.587.67.779.917.779.248 0 .597-.192.917-.779.308-.565.517-1.385.517-2.321 0-.937-.209-1.757-.517-2.322-.32-.587-.67-.779-.917-.779Zm2.526 3.868a6.433 6.433 0 0 1-.222 1.132h5.363l.058-.002a.567.567 0 0 0 0-1.128l-.058-.002H6.526ZM6.284 6.7c.109.353.188.733.234 1.132h.815l.058-.002a.567.567 0 0 0 0-1.128l-.058-.002h-1.05Zm3.316 0a.567.567 0 1 0 0 1.132h3.923a4.83 4.83 0 0 0-.293-1.132H9.6Z" clip-rule="evenodd"></path><path fill="currentColor" d="M5.434 8.667c0-.937-.209-1.757-.517-2.322-.32-.587-.67-.779-.917-.779-.248 0-.597.192-.917.779-.308.565-.517 1.385-.517 2.322 0 .936.209 1.756.517 2.321.32.587.67.779.917.779.248 0 .597-.192.917-.779.308-.565.517-1.385.517-2.321Zm1.132 0c0 1.088-.239 2.102-.655 2.864C5.508 12.27 4.857 12.9 4 12.9s-1.508-.63-1.911-1.37c-.416-.761-.655-1.775-.655-2.863 0-1.089.239-2.103.655-2.864.403-.74 1.054-1.37 1.911-1.37s1.508.63 1.911 1.37c.416.761.655 1.775.655 2.864Z"></path><path fill="currentColor" d="M4.667 8.667C4.667 9.403 4.368 10 4 10c-.368 0-.667-.597-.667-1.333 0-.737.299-1.334.667-1.334.368 0 .667.597.667 1.334Z"></path></mask><g mask="url(#mask0_1071_43807)"><path fill="currentColor" d="M0 0h16v16H0z"></path></g></svg>`;

async function getViewPowerAmountBySubscription(channelId) {
    try {
        const res = await fetch(
            `https://api.chzzk.naver.com/service/v1/channels/${channelId}/subscription`,
            { credentials: "include" }
        );
        const data = await res.json();
        const tierNo =
            data && data.content && typeof data.content.tierNo === "number"
                ? data.content.tierNo
                : null;
        if (tierNo === 1) return 120;
        if (tierNo === 2) return 200;
    } catch (e) {}
    return 100;
}

async function clickPowerButtonIfExists() {
    const aside = document.querySelector("aside#aside-chatting");
    if (!aside) return;
    const channelId = getChannelIdFromUrl();
    if (!channelId) return;
    const btn = Array.from(aside.querySelectorAll("button")).find((b) =>
        Array.from(b.classList).some((cls) =>
            cls.startsWith("live_chatting_power_button__")
        )
    );
    if (btn) {
        btn.click();
        console.log(
            "[치지직 통나무 파워 자동 획득] 자동 클릭: live_chatting_power_button"
        );
        // 로그 저장 (최근 1분 내 view 기록이 없을 때만 저장)
        try {
            const result = await browser.storage.local.get(["powerLogs"]);
            const logs = result.powerLogs || [];
            const now = Date.now();
            const hasRecentViewInStorage = logs.some(
                (log) =>
                    log &&
                    log.method === "view" &&
                    log.timestamp &&
                    new Date(log.timestamp).getTime() >= now - 60 * 1000
            );
            if (!hasRecentView) {
                const amountToLog = await getViewPowerAmountBySubscription(channelId);
                await savePowerLog(channelId, amountToLog, "view");
                // 팝업에 파워 획득 알림
                browser.runtime.sendMessage({ action: 'powerAcquired' });
            }
        } catch (e) {
            // 스토리지 조회 실패 시에는 기존 동작 유지
            const now = Date.now();
            const hasRecentViewInMemory =
                typeof lastViewLogTimestampMs === "number" &&
                lastViewLogTimestampMs >= now - 60 * 1000;
            if (!hasRecentViewInMemory) {
                const amountToLog = await getViewPowerAmountBySubscription(channelId);
                await savePowerLog(channelId, amountToLog, "view");
                lastViewLogTimestampMs = now;
                // 팝업에 파워 획득 알림
                browser.runtime.sendMessage({ action: 'powerAcquired' });
            }
        }
        fetchAndUpdatePowerAmount();
    }
}

// 시계 아이콘 SVG
const CLOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM8.5 5a.5.5 0 0 0-1 0v3a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 0-1H8.5V5Z"/></svg>`;

// 다음 파워 획득 시간 계산 (content script용)
function calculateNextPowerTimeForClock() {
    return new Promise((resolve) => {
        browser.storage.local.get(['powerLogs', 'lastPowerAcquisitionTime']).then((result) => {
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
                    nextPowerTime = calculateFromLastLogForClock(logs, now);
                }
            } else {
                // 마지막 획득 시간이 없으면 마지막 로그 기준으로 계산
                nextPowerTime = calculateFromLastLogForClock(logs, now);
            }
            
            resolve(nextPowerTime);
        }).catch((error) => {
            console.error('Storage error:', error);
            resolve(new Date(Date.now() + 60 * 60 * 1000));
        });
    });
}

// 마지막 로그 기준으로 다음 획득 시간 계산 (content script용)
function calculateFromLastLogForClock(logs, now) {
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

// 시계 표시 업데이트
async function updateClockDisplay() {
    if (!isLivePage() || !clockToggle) return;
    
    try {
        const nextPowerTime = await calculateNextPowerTimeForClock();
        const now = new Date();
        const diffMs = nextPowerTime.getTime() - now.getTime();
        
        let timeText;
        if (diffMs <= 0) {
            timeText = '곧';
        } else {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(diffMinutes / 60);
            const minutes = diffMinutes % 60;
            
            if (hours > 0) {
                timeText = `${hours}:${minutes.toString().padStart(2, '0')}`;
            } else {
                timeText = `${minutes}분`;
            }
        }
        
        createClockBadge(timeText);
    } catch (error) {
        console.error('시계 표시 업데이트 실패:', error);
    }
}

// 시계 뱃지 생성 함수
function createClockBadge(timeText) {
    // 기존 시계 뱃지 제거
    if (lastClockNode && lastClockNode.parentNode) {
        lastClockNode.parentNode.removeChild(lastClockNode);
        lastClockNode = null;
    }

    // 파워 뱃지가 있는지 확인하고 그 오른쪽에 시계 배치
    const powerBadge = document.querySelector(".chzzk_power_badge");
    if (!powerBadge || !powerBadge.parentNode) return;

    // 시계 표시 생성 및 삽입
    const clockBadge = document.createElement("button");
    clockBadge.type = "button";
    clockBadge.setAttribute("tabindex", "-1");
    clockBadge.style.display = clockToggle ? "inline-flex" : "none";
    clockBadge.style.alignItems = "center";
    clockBadge.style.justifyContent = "center";
    clockBadge.style.height = "24px";
    clockBadge.style.minWidth = "24px";
    const colors = getThemeColors();
    clockBadge.style.background = colors.bg;
    clockBadge.style.border = "none";
    clockBadge.style.padding = "0 2px";
    clockBadge.style.marginLeft = "2px"; // 파워 뱃지와 약간의 간격
    clockBadge.style.fontFamily = "inherit";
    clockBadge.style.fontWeight = "bold";
    clockBadge.style.fontSize = "11px";
    clockBadge.style.color = colors.fg;
    clockBadge.style.cursor = "pointer";
    clockBadge.addEventListener("mouseenter", () => {
        clockBadge.style.cursor = "pointer";
        clockBadge.style.background = colors.hoverBg;
    });
    clockBadge.addEventListener("mouseleave", () => {
        clockBadge.style.cursor = "pointer";
        clockBadge.style.background = colors.bg;
    });
    clockBadge.innerHTML = `${CLOCK_ICON_SVG}<span style="margin-left:4px;vertical-align:middle;">${timeText}</span>`;
    clockBadge.classList.add("chzzk_clock_badge");
    // 라이트 모드에서 아이콘 색상은 텍스트 색상과 동기화
    const svg = clockBadge.querySelector("svg");
    if (svg) {
        svg.style.color = colors.fg;
        svg.setAttribute("fill", "currentColor");
    }

    // 파워 뱃지 바로 오른쪽에 삽입
    powerBadge.parentNode.insertBefore(clockBadge, powerBadge.nextSibling);
    lastClockNode = clockBadge;
}

// 1초마다 badge 감시 및 복구
setInterval(() => {
    const badgeExists = document.querySelector(".chzzk_power_badge");
    if (!badgeExists) {
        updatePowerCountBadge();
    }
    const clockExists = document.querySelector(".chzzk_clock_badge");
    if (!clockExists && clockToggle) {
        updateClockDisplay();
    }
}, 1000);
