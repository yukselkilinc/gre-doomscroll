// STANDALONE DOOMSCROLL PWA LOGIC

let appData = [];
let activeFeedMode = 'all'; // 'all' | 'bookmarked' | 'liked' | 'learned'
let customFeedData = [];
let currentGridCategory = 'bookmarked';
let currentIndex = 0;
let commentsOpen = false;
let commentsDragActive = false;
let doomscrollTempLikes = {};
let reelPauseStates = {};
let reelSavedTimes = {};
let userHasInteracted = false;
let currentTab = 'home';
let hasResumedReelsThisSession = false; // true once the very first entry into the reels tab this session has resolved its start position
let navbarHideTimer = null;
let isMouseInNavbarZone = false;
let gridScrollPositions = {}; // remembers scroll position per grid category ('bookmarked' | 'liked' | 'learned')

function getActiveFeed() {
    return activeFeedMode === 'all' ? appData : customFeedData;
}

// --- Perf: cached DOM refs & windowed video loading state ---
// allCardEls[idx] caches the reel-card element for that index so we never have to
// re-run document.querySelectorAll('.reel-card') (which gets slower the more clips
// are imported) just to find "the card at index N".
let allCardEls = [];
// The set of indices that currently have a real <video src> attached/loaded.
// Only ever contains at most 3 entries (active reel +/- 1), regardless of how many
// clips are imported, so all playback bookkeeping stays O(1) instead of O(totalClips).
let loadedVideoWindow = new Set();
// Index of the single card currently showing the comments drawer (-1 = none), so
// closeComments() only ever has to touch that one card instead of every card.
let commentsCardIndex = -1;
// Debounce handle used to "settle" fast/flicked scrolling before we commit to
// switching the active video (see setupScrollListener below).
let scrollSettleTimer = null;
const SCROLL_SETTLE_DELAY = 90; // ms

// O(1) lookup for a reel-card element by index (replaces document.querySelectorAll('.reel-card')[idx])
function getCardEl(idx) {
    return allCardEls[idx] || null;
}

// True desktop-OS detection (Windows/Mac/Linux, not a mobile UA) rather than a
// window-width check, since a resized/narrow desktop browser window is still a
// real desktop machine with local filesystem access - which is exactly what
// the auto-loaded local video clips (see initApp) and the M/Space keyboard
// shortcuts depend on, regardless of how wide the window happens to be.
function isDesktopOS() {
    try {
        const uaData = navigator.userAgentData;
        const platform = (uaData && uaData.platform) || navigator.platform || '';
        const ua = navigator.userAgent || '';
        const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
        const isDesktopPlatform = /Win|Mac|Linux/i.test(platform) || /Win|Mac|Linux/i.test(ua);
        return isDesktopPlatform && !isMobileUA;
    } catch (e) {
        return false;
    }
}

// Keeps iOS/Android from ever surfacing this app's video as OS-level "Now
// Playing" media (Dynamic Island, Control Center, lock screen). Browsers can
// auto-populate that surface for any actively playing <video> even without
// explicit Media Session API usage, so we proactively neutralize it: no
// metadata, no action handlers, and an explicit "none" playback state. Called
// on init and again every time any pooled video starts/stops playing, since
// the OS re-evaluates this each time playback state changes.
function suppressMediaSessionSurface() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.metadata = null; } catch (e) {}
    try { navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(action => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
    });
}

// Disable automatic browser scroll restoration on refresh
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

function lockWindowScroll() {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
    }
    if (document.documentElement && document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollTop = 0;
    }
    if (document.body && document.body.scrollTop !== 0) {
        document.body.scrollTop = 0;
    }
}
window.addEventListener('scroll', lockWindowScroll, { passive: true });
window.addEventListener('resize', lockWindowScroll, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(lockWindowScroll, 50));
document.addEventListener('DOMContentLoaded', lockWindowScroll);
window.addEventListener('load', lockWindowScroll);

// Detect PWA mode and Safari non-webapp browser mode
(function detectDeviceAndMode() {
    try {
        const ua = navigator.userAgent;
        const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Android|Edg|OPR|Brave/i.test(ua));
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        if (isStandalone) {
            document.documentElement.classList.add('is-pwa');
            if (document.body) {
                document.body.classList.add('is-pwa');
            } else {
                window.addEventListener('DOMContentLoaded', () => {
                    if (document.body) document.body.classList.add('is-pwa');
                });
            }
        } else if (isSafari) {
            document.documentElement.classList.add('safari-non-webapp');
            if (document.body) {
                document.body.classList.add('safari-non-webapp');
            } else {
                window.addEventListener('DOMContentLoaded', () => {
                    if (document.body) document.body.classList.add('safari-non-webapp');
                });
            }
        }
    } catch (err) {}
})();

// Prevent main window scroll and hide scrollbars
function lockWindowScroll() {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
    }
    if (document.documentElement && document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollTop = 0;
    }
    if (document.body && document.body.scrollTop !== 0) {
        document.body.scrollTop = 0;
    }
}
window.addEventListener('scroll', lockWindowScroll, { passive: true });
window.addEventListener('resize', lockWindowScroll, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(lockWindowScroll, 50));
document.addEventListener('touchstart', lockWindowScroll, { passive: true });
document.addEventListener('touchend', lockWindowScroll, { passive: true });

// Prevent page-level rubber-band scroll at the source (mainly a Safari-non-webapp issue),
// instead of only snapping back after a visible drift. Anything inside the reels feed or
// the comments drawer is allowed to scroll/drag normally; everything else is blocked.
document.addEventListener('touchmove', (e) => {
    if (e.target.closest('#reels-feed, #comments-drawer, #comments-content-list')) return;
    if (e.cancelable) e.preventDefault();
}, { passive: false });



// Initialize Database on load
// Asynchronously checks if local/server videos/ folder is accessible on PC.
// On hosting environments like GitHub Pages or servers without local video files,
// fetch HEAD or element load fails, so PC will not auto-populate appData or stats.
async function checkVideosFolderAccess(wordsWithVideo) {
    if (!isDesktopOS()) return false;
    if (!wordsWithVideo || wordsWithVideo.length === 0) return false;
    const testWord = wordsWithVideo[0].word;
    const testUrl = `videos/${testWord}.mp4`;

    try {
        const response = await fetch(testUrl, { method: 'HEAD' });
        if (response.ok || response.status === 206 || response.status === 200) {
            return true;
        }
        if (response.status === 404) {
            return false;
        }
    } catch (err) {
        // Fall back to testing element loading below
    }

    return new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            v.onloadedmetadata = null;
            v.onerror = null;
            v.src = '';
            v.remove();
            resolve(result);
        };
        v.onloadedmetadata = () => finish(true);
        v.onerror = () => finish(false);
        setTimeout(() => finish(false), 1200);
        v.src = testUrl;
    });
}

async function initApp() {
    try {
        if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches) {
            document.body.classList.add('is-pwa');
        }
        suppressMediaSessionSurface();
        const bookName = "GRE-Essential";
        if (typeof coreDatabase === 'undefined') {
            console.error("coreDatabase is not loaded from database.js");
            return;
        }

        const bookData = coreDatabase[bookName];
        if (!bookData) {
            console.error(`Book ${bookName} not found in database.`);
            return;
        }

        // Collect all words (either from flat array or from set objects)
        let allWords = [];
        if (Array.isArray(bookData)) {
            allWords = bookData;
        } else {
            Object.keys(bookData).forEach(setName => {
                allWords = allWords.concat(bookData[setName]);
            });
        }

        // Lowercase all word identifiers
        allWords.forEach(w => {
            w.word = w.word.trim().toLowerCase();
        });

        // Filter: Keep only words that have videos
        const hasVideo = (w) => typeof VIDEO_WORDS_SET !== 'undefined' && VIDEO_WORDS_SET.has(w.word);
        const wordsWithVideo = allWords.filter(w => hasVideo(w));

        // Sort words in the order of VIDEO_WORDS_SET
        const videoWordsOrder = typeof VIDEO_WORDS_SET !== 'undefined' ? Array.from(VIDEO_WORDS_SET) : [];
        wordsWithVideo.sort((a, b) => {
            const idxA = videoWordsOrder.indexOf(a.word);
            const idxB = videoWordsOrder.indexOf(b.word);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.word.localeCompare(b.word);
        });

        // On desktop OS, assume this page is served from inside the same
        // "doomscroll_app" folder that contains the videos/ subfolder
        // (Desktop/doomscroll_app/videos/), so every word with a known clip
        // can be wired up immediately - no manual "Import Local Clips" step
        // required like on mobile, which has no direct filesystem access and
        // must go through a file picker instead.
        const hasVideoAccess = isDesktopOS() ? await checkVideosFolderAccess(wordsWithVideo) : false;

        if (hasVideoAccess) {
            appData = wordsWithVideo.map(w => ({
                ...w,
                videoSrc: `videos/${w.word}.mp4`
            }));
        } else {
            appData = []; // Mobile or PC without videos folder access: start empty
        }
        currentTab = 'home';

        renderReelsFeed();
        makeDrawerDraggable();
        updateHomeStats();
        prioritizeCollectionThumbnails();
        generateThumbnailsForEntries(appData);

        // Register scroll listener after pre-positioning
        setupScrollListener();
        initPCNavbarHoverListeners();

        // Initialize sliding active tab bubble position and focus mode button visibility on load (instantly)
        requestAnimationFrame(() => {
            positionNavbarBubble(currentTab);
            updateFocusModeBtnVisibility();
        });

        // Disable pinch and gesture zoom on iOS Safari and mobile browsers while handling reverse pinch for Focus Mode
        document.addEventListener('gesturestart', (e) => {
            e.preventDefault();
            pinchGestureActive = true;
            pinchGestureTriggered = false;
        });
        document.addEventListener('gesturechange', (e) => {
            e.preventDefault();
            if ((e.scale > 1.12 || e.scale < 0.88) && !pinchGestureTriggered) {
                pinchGestureTriggered = true;
                toggleFocusMode(e);
            }
        });
        document.addEventListener('gestureend', (e) => {
            e.preventDefault();
            pinchGestureActive = false;
            pinchGestureTriggered = false;
        });

        // Disable native double-tap-to-zoom. Some WebKit versions still trigger this on a fast
        // double tap even with touch-action set, which visually shifts the whole page (including
        // the fixed bottom navbar) up until the user pinches back out.
        document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

        // Drives the hold-gesture state machine (2x-speed zones + hold-to-
        // pause) started by onCardDown; onCardUp resolves it on release.
        window.addEventListener('pointermove', onHoldPointerMove, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (holdActive && holdZone === 'speed' && holdTriggered) {
                if (e.cancelable) e.preventDefault();
            }
        }, { passive: false });
        window.addEventListener('pointercancel', () => cancelActiveHold());

        // Track user interaction to enable auto-playback on subsequent scrolls/actions
        const setInteracted = () => {
            userHasInteracted = true;
            window.removeEventListener('click', setInteracted);
            window.removeEventListener('touchstart', setInteracted);
            window.removeEventListener('mousedown', setInteracted);
            window.removeEventListener('keydown', setInteracted);
            window.removeEventListener('wheel', setInteracted);
        };
        window.addEventListener('click', setInteracted);
        window.addEventListener('touchstart', setInteracted);
        window.addEventListener('mousedown', setInteracted);
        window.addEventListener('keydown', setInteracted);
        window.addEventListener('wheel', setInteracted);

        // PC-only keyboard shortcuts: Space toggles play/pause of the active
        // reel (instead of the browser's default page-scroll behavior), and M
        // toggles mute.
        document.addEventListener('keydown', handleGlobalKeydown);

    } catch (e) {
        console.error("Error during app initialization:", e);
    }
}

// Handles the Space (play/pause) and M (mute) keyboard shortcuts. PC only -
// mobile has no keyboard, and we don't want to hijack keystrokes typed into
// the search box or any other input field.
function handleGlobalKeydown(e) {
    if (!isDesktopOS()) return;
    if (currentTab !== 'reels') return;
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        togglePlayPauseSoft(currentIndex);
    } else if (e.key === 'm' || e.key === 'M') {
        toggleAudioMute(null, currentIndex);
    }
}

// Helper to format long show/movie names across 2 balanced lines
function formatShowName(name) {
    if (!name) return 'GRE-Essential';
    const clean = String(name).trim();
    if (clean.length > 24 && clean.includes(' ')) {
        const words = clean.split(' ');
        const mid = Math.ceil(words.length / 2);
        return words.slice(0, mid).join(' ') + '\n' + words.slice(mid).join(' ');
    }
    return clean || 'GRE-Essential';
}

// Render Swipable Reels Cards
// How many cards on each side of the active reel get a real DOM (video element,
// action buttons, word overlay, etc.) built for them. Everything outside this
// window is a cheap empty placeholder <div> of identical size, so total DOM
// weight stays bounded (~5 cards) no matter how many clips are imported - this
// is what keeps CSS transitions/animations smooth regardless of library size.
const HYDRATE_RADIUS = 2;
let hydratedLo = 0;
let hydratedHi = -1; // empty range = nothing hydrated yet

// Cheap stand-in for an off-window reel. Same size/snap behavior as a real
// card so scrolling and the IntersectionObserver work identically, but holds
// no video/buttons/listeners at all.
function createPlaceholderElement(idx) {
    const el = document.createElement('div');
    el.className = 'reel-card';
    el.dataset.index = idx;
    el.dataset.hydrated = 'false';
    return el;
}

// Builds the full, interactive reel card (video + word info + action tray + comments
// trigger) for a single word entry. Only ever called for cards inside the hydrated
// window - never for the whole library at once.
function createReelCardElement(w, idx) {
    const card = document.createElement('div');
    card.className = 'reel-card';
    card.dataset.index = idx;
    card.dataset.word = w.word;
    card.dataset.hydrated = 'true';

    // Custom states from localStorage
    const isLiked = getLikeState(w.word);
    const isBookmarked = getBookmarkState(w.word);
    const isLearned = getLearnedState(w.word);

    // SVG templates
    const heartFillColor = isLiked ? '#ef4444' : 'none';
    const heartStrokeColor = isLiked ? '#ef4444' : 'currentColor';
    const bookmarkFillColor = isBookmarked ? '#ffffff' : 'none';
    const bookmarkStrokeColor = isBookmarked ? '#ffffff' : 'currentColor';

    const baseLikes = (w.word || '').length + (w.def || '').length + (w.example || '').length + (w.long_example || '').length;
    const displayLikes = isLiked ? baseLikes + 1 : baseLikes;

    const masterSvg = isLearned
        ? `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" viewBox="0 0 24 24">
               <circle cx="12" cy="12" r="10" fill="white" stroke="white" stroke-width="1.6"></circle>
               <path stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"></path>
           </svg>`
        : `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24">
               <circle cx="12" cy="12" r="10"></circle>
               <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"></path>
           </svg>`;

    // Movie/TV Show display name
    const rawMovieName = (w && (w.show || w.source)) || (typeof VIDEO_SHOWS !== 'undefined' && w && VIDEO_SHOWS[w.word]) || "GRE-Essential";
    const movieName = String(rawMovieName || "GRE-Essential");
    const safeMovieName = movieName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const videoSrc = w.videoSrc || `videos/${w.word}.mp4`;

    card.innerHTML = `
        <!-- Video Container -->
        <div class="reel-video-container w-full h-full relative flex items-center justify-center bg-gradient-to-b from-neutral-950 via-neutral-900 to-black overflow-hidden" onpointerdown="onCardDown(event, ${idx})" onpointerup="onCardUp(event, ${idx})">
            <!-- The actual <video> element is attached here on demand from a shared
                 pool (see attachVideoToCard) - it is not part of this template. -->

            <!-- Centered Play Icon Overlay (indicates video is paused) -->
            <div class="play-pause-overlay absolute inset-0 pointer-events-none opacity-0 z-20 transition-opacity duration-200">
                <!-- Play Icon Button: PERFECTLY CENTERED ON SCREEN (pointer-events-auto) -->
                <button onclick="event.stopPropagation(); handlePlayButtonTap(event, ${idx});" onpointerdown="event.stopPropagation();" ontouchstart="event.stopPropagation();" onpointerup="event.stopPropagation();" ontouchend="event.stopPropagation();" class="play-center-btn pointer-events-none hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-white shadow-2xl active:scale-95 transition-all select-none cursor-default" id="play-center-btn-${idx}" aria-label="Toggle Play/Pause">
                    <svg class="w-12 h-12 md:w-14 md:h-14 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
                    </svg>
                </button>

                <!-- Separate Small Mute Button (positioned above play icon, fixed tiny size) -->
                <button onclick="event.stopPropagation(); toggleAudioMute(event, ${idx});" onpointerdown="event.stopPropagation(); markMuteTapped(event);" ontouchstart="event.stopPropagation(); markMuteTapped(event);" onpointerup="event.stopPropagation(); markMuteReleased(event);" ontouchend="event.stopPropagation(); markMuteReleased(event);" class="play-mute-btn pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[80px] md:-translate-y-[90px] p-2 rounded-full bg-black/40 backdrop-blur-md border border-white/15 text-white/90 shadow-md transition select-none" id="play-mute-btn-${idx}" aria-label="Toggle Mute">
                    ${getMuteIconSvg(isAppMuted, 'tiny')}
                </button>
            </div>

            <!-- 2x Speed Gesture Disclaimer (below the video, not overlaying its center) -->
            <div class="speed-disclaimer absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 opacity-0 pointer-events-none select-none" style="transition: opacity 0.15s ease; top: auto; bottom: calc(68px + env(safe-area-inset-bottom, 0px));" data-current-label="">
                <span class="speed-disclaimer-icon inline-flex items-center justify-center w-4 h-4 text-white"></span>
                <span class="speed-disclaimer-text text-white text-[13px] font-medium tracking-wide drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]"></span>
            </div>
        </div>

        <!-- Top Center Movie/Show Badge (hides when comments active; original on PWA, 10px on PC, 34px on Safari browser) -->
        <div class="show-badge-container absolute left-1/2 -translate-x-1/2 z-30 transition-all duration-200 pointer-events-auto max-w-[85vw]" style="top: ${window.innerWidth >= 768 ? '10px' : ((window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches) ? 'max(calc(env(safe-area-inset-top, 0px) + 34px), 88px)' : 'calc(env(safe-area-inset-top, 16px) + 34px)')};">
            <div onclick="openShowIMDB(event, '${safeMovieName}')" class="flex items-center gap-1.5 md:gap-2 bg-black/50 backdrop-blur-md px-3.5 py-1.5 md:px-4 md:py-2 rounded-2xl md:rounded-full border border-white/15 shadow-lg hover:bg-black/70 cursor-pointer transition text-center">
                <svg class="w-3.5 h-3.5 md:w-[15px] md:h-[15px] text-white fill-current shrink-0" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                <span class="text-[10.5px] md:text-[12.5px] font-semibold text-white/90 text-center leading-snug whitespace-pre-line tracking-wide break-words">${formatShowName(movieName)}</span>
            </div>
        </div>

        <!-- Bottom Left Info Overlay -->
        <div class="word-info-overlay max-w-[70vw] md:max-w-[65vw]">
            <h2 class="text-2xl md:text-[36px] leading-tight font-serif font-extrabold text-white tracking-wide flex items-center gap-2 flex-wrap">
                <span class="capitalize">${w.word}</span>
                <span class="text-xs md:text-[18px] font-sans italic text-white/80 lowercase">${w.type}</span>
            </h2>
            <p class="text-sm md:text-[21px] font-medium text-white/90 leading-relaxed mt-2 max-w-full break-words whitespace-normal">${w.def}</p>
        </div>

        <!-- Vertical Action Sidebar -->
        <div class="action-tray">
            <!-- Like (50% bigger: w-[33px] h-[33px]) -->
            <div class="flex flex-col items-center">
                <button onclick="toggleLike(event, '${w.word}', ${idx})" class="action-btn" id="like-btn-${idx}">
                    <svg class="w-[33px] h-[33px]" fill="${heartFillColor}" stroke="${heartStrokeColor}" stroke-width="1.8" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span id="like-count-${idx}" data-base="${baseLikes}" class="text-[10px] font-bold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] mt-0.5 select-none" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${displayLikes}</span>
            </div>

            <!-- Comments (50% bigger: w-[33px] h-[33px]) -->
            <div class="flex flex-col items-center">
                <button onclick="openComments(event, ${idx})" class="action-btn">
                    <svg class="w-[33px] h-[33px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                        <path d="M3 11.5a8.38 8.38 0 00.9 3.8 8.5 8.5 0 007.6 4.7 8.38 8.38 0 003.8-.9L21 21l-1.9-5.7a8.38 8.38 0 00.9-3.8 8.5 8.5 0 00-4.7-7.6 8.38 8.38 0 00-3.8-.9h-.5a8.48 8.48 0 00-8 8v.5z"></path>
                    </svg>
                </button>
                <span class="text-[10px] font-bold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] mt-0.5 select-none" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">3</span>
            </div>

            <!-- Bookmark (Save) (25% bigger on mobile: 27.5px, 20% smaller on PC: 22px) -->
            <button onclick="toggleBookmark(event, '${w.word}', ${idx})" class="action-btn" id="bookmark-btn-${idx}">
                <svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px]" fill="${bookmarkFillColor}" stroke="${bookmarkStrokeColor}" stroke-width="1.8" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
                </svg>
            </button>

            <!-- Mark Learned / Master (Learn) (25% bigger on mobile: 27.5px, 20% smaller on PC: 22px) -->
            <button onclick="toggleLearned(event, '${w.word}', ${idx})" class="action-btn" id="learned-btn-${idx}">
                ${masterSvg}
            </button>

            <!-- Focus Mode (><) Button (below Learn button, activates instantly on touch/click) -->
            <button onclick="toggleFocusMode(event, ${idx})" onpointerdown="event.stopPropagation()" onpointerup="event.stopPropagation()" ontouchstart="event.stopPropagation(); toggleFocusMode(event, ${idx})" ontouchend="event.stopPropagation()" class="action-btn focus-mode-btn rounded-full p-2 text-white flex items-center justify-center mt-1" id="focus-mode-btn-${idx}" aria-label="Toggle Focus Mode">
                ${FOCUS_MODE_SVG}
            </button>
        </div>
    `;

    return card;
}

// --- Reusable <video> element pool -----------------------------------------
// Constantly creating and destroying <video> elements as cards hydrate/dehydrate
// (which is what earlier versions of this file did) causes real, intermittent
// playback hiccups on mobile WebKit - the media pipeline doesn't always recover
// cleanly from rapid element churn, which is what caused reels to randomly land
// paused a few swipes into a session. Instead, a small pool of real <video>
// elements is created once and reused for the whole session: as a card enters
// the active video window it "borrows" a free pooled element (or the least
// recently used one) and reparents it into its container; leaving cards return
// their element to the pool instead of destroying it.
let videoPool = [];
let cardVideoMap = new Map(); // cardIndex -> the pooled <video> element attached to it

function pooledVideoAssignedIndex(video) {
    const raw = video.dataset.assignedIndex;
    return raw === undefined || raw === '' ? -1 : parseInt(raw, 10);
}

// iOS Safari seeks back to the nearest sync point (~t=0 on short clips) when a
// playing, not-fully-buffered video's playbackRate changes - which reads as the
// clip "starting over" on 2x-hold and again on release. Every rate change must
// therefore be routed through here so we can arm a short-lived guard; the
// seeked/timeupdate listeners in createPooledVideoElement cancel any phantom
// backward jump by restoring the forward-most position seen since arming.
function setPlaybackRate(video, rate) {
    if (!video) return;
    // Preserve an already-armed guard's snapshot instead of re-snapshotting:
    // repeated rate writes during a drag can fire while iOS has already snapped
    // currentTime toward 0, and overwriting the guard there would permanently
    // lose the position the user was actually watching.
    if (video.dataset.guardArmed !== '1') {
        video.dataset.guardMax = String(video.currentTime || 0);
        video.dataset.guardArmed = '1';
    }
    video.playbackRate = rate;
    // Self-disarm in case no seeked event fires (desktop / already-buffered
    // playback) so the guard can never linger and swallow a later legit seek.
    setTimeout(() => { delete video.dataset.guardArmed; }, 700);
}

// Disarms the rate-change seek guard after an intentional currentTime write
// (attach reset, saved-position restore, ended reset) so it never overrides a
// legitimate seek. A natural end-of-loop restart needs no exemption here - the
// seeked listener's end-of-loop check already leaves those alone.
function markLegitSeek(video) {
    if (!video) return;
    delete video.dataset.guardArmed;
    delete video.dataset.guardMax;
}

function createPooledVideoElement() {
    const video = document.createElement('video');
    video.className = 'reel-video';
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.preservesPitch = true;
    video.webkitPreservesPitch = true;
    video.mozPreservesPitch = true;
    video.preload = 'none';
    video.dataset.assignedIndex = '';

    // Never let this show up as OS-level "Now Playing" media (Dynamic Island,
    // Control Center, lock screen, AirPlay picker, etc.) - short vocab clips
    // constantly swapping out shouldn't ever surface there, exactly like
    // Instagram/TikTok's web apps.
    video.disableRemotePlayback = true;
    video.setAttribute('disableRemotePlayback', '');
    video.setAttribute('disablePictureInPicture', '');
    video.setAttribute('x-webkit-airplay', 'deny');

    // Listeners read the index currently assigned to THIS element (rather than
    // capturing one in a closure), since the same element gets reused across
    // many different cards over the course of a scrolling session.
    video.addEventListener('play', () => {
        updatePlayIconVisibility(pooledVideoAssignedIndex(video));
        suppressMediaSessionSurface();
    });
    video.addEventListener('playing', () => {
        const idx = pooledVideoAssignedIndex(video);
        updatePlayIconVisibility(idx);
        suppressMediaSessionSurface();
        if (idx === currentIndex && !isAppMuted) {
            video.muted = false;
            video.volume = 1.0;
        }
    });
    video.addEventListener('pause', () => {
        updatePlayIconVisibility(pooledVideoAssignedIndex(video));
        suppressMediaSessionSurface();
    });
    video.addEventListener('canplay', () => updatePlayIconVisibility(pooledVideoAssignedIndex(video)));
    video.addEventListener('loadedmetadata', () => updateDefinitionMaxWidths(pooledVideoAssignedIndex(video)));

    // iOS Safari phantom-seek guard: when setPlaybackRate arms the guard during
    // a rate change, AVPlayer's snap-back to the nearest sync point manifests as
    // a currentTime drop. Forward-track the highest position seen while the
    // guard is armed (so a restore lands where playback actually got to, even
    // after a long hold or repeated re-arms), and on any seeked that falls well
    // behind that position, restore it.
    video.addEventListener('timeupdate', () => {
        if (video.dataset.guardArmed !== '1') return;
        const guardMax = parseFloat(video.dataset.guardMax || '0');
        if (isFinite(guardMax) && video.currentTime > guardMax) {
            video.dataset.guardMax = String(video.currentTime);
        }
    });
    video.addEventListener('seeked', () => {
        if (video.dataset.guardArmed !== '1') return;
        const guardMax = parseFloat(video.dataset.guardMax);
        if (!isFinite(guardMax)) { delete video.dataset.guardArmed; return; }
        const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        // A backward jump that isn't a natural end-of-loop restart.
        if (video.currentTime < guardMax - 0.4 && guardMax < dur - 0.4) {
            try { video.currentTime = guardMax; } catch (e) {}
            // Stay armed (the setPlaybackRate disarm timer cleans up) so a
            // second phantom seek iOS performs right after the restore is also
            // caught instead of slipping through and restarting the clip. The
            // restore's own seeked event disarms the guard normally.
        } else {
            delete video.dataset.guardArmed;
        }
    });

    return video;
}

function acquirePooledVideo() {
    const inUse = new Set(cardVideoMap.values());
    let video = videoPool.find(v => !inUse.has(v));
    if (!video) {
        video = createPooledVideoElement();
        videoPool.push(video);
    }
    return video;
}

// Ensures the card at `idx` has a pooled <video> element attached to its
// container, borrowing one from the pool (or reusing whichever is already
// attached) rather than creating a new element. Returns the video element, or
// null if the card isn't hydrated (shouldn't normally happen for indices this
// is called with).
function attachVideoToCard(idx) {
    const card = getCardEl(idx);
    if (!card || card.dataset.hydrated !== 'true') return null;

    let video = cardVideoMap.get(idx);
    if (video && video.isConnected && pooledVideoAssignedIndex(video) === idx) return video;

    const container = card.querySelector('.reel-video-container');
    if (!container) return null;

    video = acquirePooledVideo();
    // Reset it for its new assignment - always start muted (see playActiveVideo
    // for why: browsers reliably allow muted autoplay even outside a direct
    // user gesture, e.g. scroll momentum, whereas unmuted autoplay in that
    // situation is frequently blocked).
    if (!video.paused) video.pause();
    video.muted = true;
    setPlaybackRate(video, 1);
    video.removeAttribute('src');
    video.load();
    video.preload = 'none';
    video.currentTime = 0;
    markLegitSeek(video);
    video.dataset.assignedIndex = String(idx);

    const feedData = getActiveFeed();
    const w = feedData[idx];
    const videoSrc = w ? (w.videoSrc || `videos/${w.word}.mp4`) : '';
    if (videoSrc) video.setAttribute('data-src', videoSrc);
    else video.removeAttribute('data-src');

    const overlay = container.querySelector('.play-pause-overlay');
    if (overlay) container.insertBefore(video, overlay);
    else container.appendChild(video);

    applyFillModeToVideo(video);

    cardVideoMap.set(idx, video);
    return video;
}

// Returns a card's pooled video back to the pool (paused, muted, unloaded) so
// it's available for reuse by whichever card needs one next, without ever
// destroying the element itself.
function detachVideoFromCard(idx) {
    const video = cardVideoMap.get(idx);
    if (!video) return;
    video.muted = true;
    if (!video.paused) video.pause();
    if (video.hasAttribute('src') || (video.src && video.src !== '')) {
        video.removeAttribute('src');
        video.load();
    }
    video.preload = 'none';
    video.dataset.assignedIndex = '';
    if (video.parentElement) video.parentElement.removeChild(video);
    cardVideoMap.delete(idx);
    loadedVideoWindow.delete(idx);
}

// Ensures only cards within HYDRATE_RADIUS of centerIndex have a real DOM (video,
// buttons, overlays); everything else is swapped down to a lightweight placeholder.
// Because we track the previously-hydrated range (hydratedLo/hydratedHi) we only
// ever touch the handful of cards actually entering/leaving the window - this is
// O(radius), never O(total imported clips), even on a big jump (search/random word).
function hydrateWindow(centerIndex) {
    const feedData = getActiveFeed();
    if (!feedData.length || typeof centerIndex !== 'number' || isNaN(centerIndex)) return;

    const lo = Math.max(0, centerIndex - HYDRATE_RADIUS);
    const hi = Math.min(feedData.length - 1, centerIndex + HYDRATE_RADIUS);

    // Demote cards that are leaving the hydrated window back to placeholders.
    for (let i = hydratedLo; i <= hydratedHi; i++) {
        if (i >= lo && i <= hi) continue;
        if (commentsOpen && i === commentsCardIndex) continue; // never tear down while its comments are open
        if (i === currentIndex) continue; // never tear down the reel that's actually playing right now
        const el = allCardEls[i];
        if (el && el.dataset.hydrated === 'true') {
            detachVideoFromCard(i);
            const placeholder = createPlaceholderElement(i);
            el.replaceWith(placeholder);
            allCardEls[i] = placeholder;
            if (reelsObserver) reelsObserver.observe(placeholder);
            loadedVideoWindow.delete(i);
        }
    }

    // Promote cards newly entering the window into full, interactive cards.
    for (let i = lo; i <= hi; i++) {
        const el = allCardEls[i];
        if (el && el.dataset.hydrated !== 'true') {
            const full = createReelCardElement(feedData[i], i);
            el.replaceWith(full);
            allCardEls[i] = full;
            if (reelsObserver) reelsObserver.observe(full);
        }
    }

    hydratedLo = Math.min(lo, currentIndex);
    hydratedHi = Math.max(hi, currentIndex);

    if (focusModeActive) applyFocusModeStyles();
}

function renderReelsFeed(targetIndex) {
    const feed = document.getElementById('reels-feed');
    const feedData = getActiveFeed();
    // Save currentTime of the active reel (and any user-paused reel) so we can
    // restore it when the video is re-attached after the feed rebuild. This
    // preserves the exact paused frame when navigating away from and back to
    // the reels page. We skip neighboring preloaded reels — their currentTimes
    // are unreliable (usually 0 or a fraction of a second from pre-buffering).
    cardVideoMap.forEach((video, idx) => {
        if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
            if (reelPauseStates[idx] || idx === currentIndex) {
                reelSavedTimes[idx] = video.currentTime;
            }
        }
    });

    // Detach (not destroy) any pooled videos before wiping the feed's DOM, so the
    // <video> elements themselves survive for reuse in the freshly rendered feed
    // instead of being thrown away and recreated.
    cardVideoMap.forEach(video => {
        if (!video.paused) video.pause();
        video.muted = true;
        video.dataset.assignedIndex = '';
    });
    cardVideoMap = new Map();
    feed.innerHTML = '';
    allCardEls = new Array(feedData.length);
    loadedVideoWindow = new Set();
    commentsCardIndex = -1;
    hydratedLo = 0;
    hydratedHi = -1;

    if (feedData.length === 0) {
        feed.style.overflowY = 'hidden';
        feed.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full p-6 text-center select-none">
                <div class="w-16 h-16 mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-teal-400">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
                <h2 class="text-xl font-serif font-bold text-white mb-2">${activeFeedMode !== 'all' ? 'No Items in Collection' : 'No Clips Imported Yet'}</h2>
                <p class="text-xs text-white/50 mb-6 max-w-xs leading-relaxed">${activeFeedMode !== 'all' ? 'Add items to this collection while swiping.' : 'Import your local GRE video clips to start studying vocabulary reels.'}</p>
                <button onclick="${activeFeedMode !== 'all' ? 'returnToGridFromReels()' : 'importLocalClips()'}" class="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-full text-xs font-semibold transition">
                    ${activeFeedMode !== 'all' ? 'Back to Collection' : 'Import Clips'}
                </button>
            </div>
        `;
        return;
    }

    feed.style.overflowY = 'scroll';

    // Build the full list as cheap placeholders first (this is the only O(totalClips)
    // work we ever do, and it's trivial - a single empty <div> per clip, one reflow
    // via the fragment). The active window then gets hydrated into real cards below.
    const frag = document.createDocumentFragment();
    for (let idx = 0; idx < feedData.length; idx++) {
        const placeholder = createPlaceholderElement(idx);
        allCardEls[idx] = placeholder;
        frag.appendChild(placeholder);
    }
    feed.appendChild(frag);

    setupScrollListener();
    const initialIndex = (typeof targetIndex === 'number' && !isNaN(targetIndex) && targetIndex >= 0 && targetIndex < feedData.length)
        ? targetIndex
        : getResumeIndex();
    hydrateWindow(initialIndex);

    requestAnimationFrame(updateDefinitionMaxWidths);
}

// Calculate dynamic max-width for definition text on PC to strictly prevent text from overlapping the video
function updateDefinitionMaxWidths(centerIndex) {
    const isPC = window.innerWidth >= 768;
    const idx = (typeof centerIndex === 'number' && !isNaN(centerIndex)) ? centerIndex : currentIndex;
    // Only the active card (and its immediate neighbors, in case of an in-progress
    // swipe) can ever be visible, so there's no need to touch every imported clip.
    const indices = [idx - 1, idx, idx + 1].filter(i => i >= 0 && i < appData.length);
    const cards = indices.map(getCardEl).filter(Boolean);

    cards.forEach(card => {
        const overlay = card.querySelector('.word-info-overlay');
        const p = overlay ? overlay.querySelector('p') : null;
        if (!overlay || !p) return;
        
        if (isPC) {
            const video = card.querySelector('.reel-video');
            let videoAspect = 9 / 16;
            if (video && video.videoWidth && video.videoHeight) {
                videoAspect = video.videoWidth / video.videoHeight;
            }
            
            const videoH = window.innerHeight - 64;
            const actualVideoW = Math.min(window.innerWidth, videoH * videoAspect);
            const actualVideoLeft = (window.innerWidth - actualVideoW) / 2;
            
            const overlayLeft = overlay.getBoundingClientRect().left || 16;
            const maxW = Math.max(160, Math.floor((actualVideoLeft - overlayLeft - 16) * 0.90));
            
            p.style.maxWidth = `${maxW}px`;
            p.style.wordBreak = 'break-word';
            p.style.whiteSpace = 'normal';
        } else {
            p.style.maxWidth = ''; // Mobile default
        }
    });
}

let isAppMuted = false;

function getMuteIconSvg(isMuted, size = 'normal') {
    let sizeClasses = 'w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px]';
    if (size === 'medium') sizeClasses = 'w-6 h-6 md:w-[26px] md:h-[26px]';
    if (size === 'small') sizeClasses = 'w-4 h-4 md:w-4 md:h-4';
    if (size === 'tiny') sizeClasses = 'w-3.5 h-3.5 md:w-3.5 md:h-3.5';

    return isMuted 
        ? `<svg class="${sizeClasses} pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4"/>
           </svg>`
        : `<svg class="${sizeClasses} pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
           </svg>`;
}

function updateMuteButtonIcons() {
    const indices = new Set(loadedVideoWindow);
    indices.add(currentIndex);
    indices.forEach(idx => {
        const btn = document.getElementById(`mute-btn-${idx}`);
        if (btn) btn.innerHTML = getMuteIconSvg(isAppMuted);
        const playBtn = document.getElementById(`play-mute-btn-${idx}`);
        if (playBtn) playBtn.innerHTML = getMuteIconSvg(isAppMuted, 'tiny');
    });
    const commentsBtn = document.getElementById('comments-mute-btn');
    if (commentsBtn) commentsBtn.innerHTML = getMuteIconSvg(isAppMuted, 'small');
}

let isMuteButtonPressed = false;
let lastPlayTapTime = 0;

function handlePlayButtonTap(e, index) {
    if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault && e.cancelable) e.preventDefault();
    }
    if (tapTimeout) {
        clearTimeout(tapTimeout);
        tapTimeout = null;
    }
    lastTap = 0;
    lastTapX = 0;
    lastTapY = 0;
    lastTapIndex = -1;
    userHasInteracted = true;
    togglePlayPauseSoft(index);
}

function markMuteTapped(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
    lastTap = 0;
    isMuteButtonPressed = true;
}

function markMuteReleased(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
    lastTap = 0;
    setTimeout(() => {
        isMuteButtonPressed = false;
    }, 0);
}

function toggleAudioMute(e, index) {
    if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault && e.cancelable) e.preventDefault();
    }
    if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
    lastTap = 0;
    isMuteButtonPressed = true;
    setTimeout(() => { isMuteButtonPressed = false; }, 0);
    userHasInteracted = true;
    const targetIdx = (typeof index === 'number' && !isNaN(index)) ? index : currentIndex;
    const card = getCardEl(targetIdx);
    const video = card ? card.querySelector('.reel-video') : null;

    if (video) {
        if (video.muted) {
            video.muted = false;
            isAppMuted = false;
        } else {
            video.muted = true;
            isAppMuted = true;
        }
    } else {
        isAppMuted = !isAppMuted;
    }
    requestAnimationFrame(() => updateMuteButtonIcons());
}

// Synchronous mobile audio unlocker on touch/click gestures
function unlockMobileAudio() {
    userHasInteracted = true;
    if (isAppMuted) return;
    const card = getCardEl(currentIndex);
    if (card) {
        const v = card.querySelector('.reel-video');
        if (v) {
            v.muted = false;
            v.volume = 1.0;
        }
    }
}

['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click'].forEach(evtName => {
    window.addEventListener(evtName, unlockMobileAudio, { capture: true, passive: true });
});

// --- Focus Mode (><) button: liquid-glass circled UI hide toggle -----------------
// A liquid-glass circled "><" button situated inside each card's action tray below the Learn button.
// Tapping it hides all UI overlays globally across all reels without zooming the video.
const FOCUS_MODE_SVG = `<svg class="w-[28px] h-[28px] md:w-[24px] md:h-[24px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6.5 10h3.5V6.5"></path>
    <path d="M17.5 14h-3.5v3.5"></path>
</svg>`;
const SPLIT_ARROW_SVG = FOCUS_MODE_SVG;

let focusModeActive = false;
let videoFillModeActive = false;

function applyFillModeToVideo(video) {
    if (!video) return;
    video.style.objectFit = '';
}

function updateFocusModeBtnVisibility() {
    const btn = document.getElementById('focus-mode-btn');
    if (!btn) return;
    const feed = document.getElementById('reels-feed');
    const isReels = feed && !feed.classList.contains('hidden');
    if (isReels) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function applyFocusModeStyles() {
    document.querySelectorAll('.word-info-overlay, .show-badge-container').forEach(el => {
        el.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('.action-tray').forEach(tray => {
        Array.from(tray.children).forEach(child => {
            if (!child.classList.contains('focus-mode-btn')) {
                child.style.setProperty('visibility', 'hidden', 'important');
            }
        });
    });
    document.querySelectorAll('.focus-mode-btn').forEach(el => {
        el.style.setProperty('background-color', 'rgba(255,255,255,0.06)', 'important');
        el.style.setProperty('border', 'none', 'important');
        el.style.setProperty('backdrop-filter', 'blur(14px)', 'important');
        el.style.setProperty('-webkit-backdrop-filter', 'blur(14px)', 'important');
        el.style.setProperty('box-shadow', '0 4px 16px rgba(0,0,0,0.15)', 'important');
        el.style.setProperty('border-radius', '9999px', 'important');
    });
}

function removeFocusModeStyles() {
    document.querySelectorAll('.word-info-overlay, .show-badge-container').forEach(el => {
        el.style.display = '';
    });
    document.querySelectorAll('.action-tray').forEach(tray => {
        Array.from(tray.children).forEach(child => {
            if (!child.classList.contains('focus-mode-btn')) {
                child.style.visibility = '';
            }
        });
    });
    document.querySelectorAll('.focus-mode-btn').forEach(el => {
        el.style.backgroundColor = '';
        el.style.border = '';
        el.style.backdropFilter = '';
        el.style.webkitBackdropFilter = '';
        el.style.boxShadow = '';
        el.style.borderRadius = '';
    });
}

let focusToggleProcessing = false;
function toggleFocusMode(e) {
    if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault && e.cancelable) e.preventDefault();
    }
    if (focusToggleProcessing) return;
    focusToggleProcessing = true;
    setTimeout(() => { focusToggleProcessing = false; }, 350);

    focusModeActive = !focusModeActive;
    if (focusModeActive) {
        document.body.classList.add('focus-mode-active');
        applyFocusModeStyles();
    } else {
        document.body.classList.remove('focus-mode-active');
        removeFocusModeStyles();
    }
}

function toggleSplitArrowButton(e) {
    toggleFocusMode(e);
}

// Pinch gesture toggles focus mode (moving fingers away)
let pinchGestureActive = false;
let pinchGestureTriggered = false;
let pinchStartDistance = 0;
const PINCH_OUT_TRIGGER_PX = 18;

function getTouchPointDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function onFeedTouchStart(e) {
    if (e.touches && e.touches.length === 2) {
        pinchGestureActive = true;
        pinchGestureTriggered = false;
        pinchStartDistance = getTouchPointDistance(e.touches);
        cancelActiveHold();
    }
}

function onFeedTouchMove(e) {
    if (!pinchGestureActive || !e.touches || e.touches.length !== 2) return;
    const dist = getTouchPointDistance(e.touches);
    if (!pinchGestureTriggered && Math.abs(dist - pinchStartDistance) > PINCH_OUT_TRIGGER_PX) {
        pinchGestureTriggered = true;
        toggleFocusMode(e);
    }
}

function onFeedTouchEnd(e) {
    if (!e.touches || e.touches.length < 2) {
        pinchGestureActive = false;
        pinchGestureTriggered = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('touchstart', onFeedTouchStart, { passive: false });
    document.addEventListener('touchmove', onFeedTouchMove, { passive: false });
    document.addEventListener('touchend', onFeedTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onFeedTouchEnd, { passive: true });
});

// Helper to show play icon overlay ONLY when the currently active reel is explicitly user-paused
function updatePlayIconVisibility(index) {
    const card = getCardEl(index);
    if (!card) return;
    const overlay = card.querySelector('.play-pause-overlay');
    const playBtn = card.querySelector('.play-center-btn');
    if (!overlay) return;

    const hidePlayBtn = () => {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        if (playBtn) {
            playBtn.style.pointerEvents = 'none';
            playBtn.style.cursor = 'default';
            playBtn.style.display = 'none';
        }
    };

    const showPlayBtn = () => {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        if (playBtn) {
            playBtn.style.pointerEvents = 'auto';
            playBtn.style.cursor = 'pointer';
            playBtn.style.display = 'block';
        }
    };

    // If comments section is open or this is NOT the current active reel, play icon MUST be hidden
    if (commentsOpen || index !== currentIndex) {
        hidePlayBtn();
        return;
    }

    // For the currently active reel, ONLY show play icon if it is explicitly user-paused (with 80ms smooth delay)
    if (reelPauseStates[index]) {
        setTimeout(() => {
            if (reelPauseStates[index] && index === currentIndex && !commentsOpen) {
                showPlayBtn();
            } else {
                hidePlayBtn();
            }
        }, 80);
    } else {
        hidePlayBtn();
    }
}

function updateAllPlayIconVisibilities() {
    // Only cards inside the loaded-video window (at most 3) can possibly need their
    // play/pause overlay touched - every other card is already unloaded & hidden.
    const indices = new Set(loadedVideoWindow);
    indices.add(currentIndex);
    indices.forEach(idx => updatePlayIconVisibility(idx));
}

// Soft play/pause for the CURRENTLY ACTIVE reel: instead of calling the real
// HTMLMediaElement pause()/play() - which tears down and re-establishes the
// audio output session, the ~0.5s silent gap on resume - we freeze playback
// by setting playbackRate to 0 and resume by restoring it. video.paused stays
// false throughout (the decode/audio pipeline never actually stops), so
// sound comes back the instant playbackRate is restored, matching the
// spam-pause/play feel of native apps.
function togglePlayPauseSoft(index) {
    if (isMuteButtonPressed) return;
    const card = getCardEl(index);
    if (!card) return;
    const video = card.querySelector('.reel-video');
    if (!video || video.classList.contains('hidden')) return;

    if (reelPauseStates[index]) {
        // Resume
        reelPauseStates[index] = false;
        setPlaybackRate(video, (speedLocked && index === currentIndex) ? 2 : 1);
        if (video.paused) {
            // Only true if the element was ever hard-paused elsewhere (e.g. a
            // freshly attached reel that never started) - fall back to play().
            video.play().catch(() => {});
        }
    } else {
        // Pause (soft freeze - see comment above)
        reelPauseStates[index] = true;
        setPlaybackRate(video, 0);
    }
    updatePlayIconVisibility(index);
}

let activeTargetIndex = -1;
let playWatchdogTimer = null;

// Play active video card, pause all others, and pre-buffer nearby cards for 0ms scroll delay.
// IMPORTANT: this only ever touches the active index +/- 1 (via loadedVideoWindow), never
// every imported clip - that's what keeps this O(1) regardless of whether you've imported
// 1 clip or 500.
function playActiveVideo(index) {
    const feedData = getActiveFeed();
    updateDefinitionMaxWidths(index);
    activeTargetIndex = index;



    // Scrolling to a (new) reel always resets speed back to normal, whether or
    // not it was locked at 2x - pausing never does this, only navigation does.
    cancelActiveHold();
    speedLocked = false;
    hideAllSpeedDisclaimers();
    const activeCardForSpeed = getCardEl(index);
    const activeVideoForSpeed = activeCardForSpeed ? activeCardForSpeed.querySelector('.reel-video') : null;
    if (activeVideoForSpeed) setPlaybackRate(activeVideoForSpeed, 1);
    const newWindow = new Set();
    for (let d = -1; d <= 1; d++) {
        const i = index + d;
        if (i >= 0 && i < feedData.length) newWindow.add(i);
    }

    // STEP 1: Return any videos that have left the virtual window back to the pool
    // (paused, muted, unloaded, detached) so they're free for reuse elsewhere.
    loadedVideoWindow.forEach(i => {
        if (newWindow.has(i)) return;
        detachVideoFromCard(i);
        updatePlayIconVisibility(i);
    });

    // STEP 2: Immediately lock & mute every other video still inside the window to
    // prevent any audio leak before the active reel's play() promise resolves.
    newWindow.forEach(i => {
        if (i === index) return;
        const video = cardVideoMap.get(i);
        if (video) {
            video.muted = true;
            if (!video.paused) video.pause();
        }
    });

    // STEP 3: Load/manage the virtual window (active reel + immediate neighbors)
    newWindow.forEach(idx => {
        const video = attachVideoToCard(idx);
        if (!video) return;

        const dataSrc = video.getAttribute('data-src') || (feedData[idx] ? (feedData[idx].videoSrc || `videos/${feedData[idx].word}.mp4`) : '');
        if (dataSrc && (!video.src || video.src === '' || !video.src.includes(encodeURI(dataSrc)))) {
            video.src = dataSrc;
            video.load();
        }

        if (idx === index) {
            // ACTIVE REEL
            video.preload = 'auto';
            video.volume = 1.0;

            // Restore saved playback position (e.g. when returning from
            // home/search to a paused reel) so it resumes from the exact
            // frame the user left off, not from the beginning.
            if (reelSavedTimes[idx] !== undefined) {
                try { video.currentTime = reelSavedTimes[idx]; } catch (e) {}
                markLegitSeek(video);
                delete reelSavedTimes[idx];
            }

            if (reelPauseStates[index]) {
                if (!video.paused) video.pause();
                video.muted = isAppMuted;
                updatePlayIconVisibility(idx);
            } else {
                // Reset position ONLY if ended
                if (video.ended) {
                    try { video.currentTime = 0; } catch (e) {}
                    markLegitSeek(video);
                }

                // Mobile browsers (notably Safari) reliably allow MUTED autoplay even
                // when it's not triggered by a direct tap - e.g. fired from an
                // IntersectionObserver during scroll momentum - but frequently BLOCK
                // unmuted autoplay in that same situation. Starting the attempt
                // unmuted (as this used to) meant play() itself could get rejected
                // outright, leaving the reel silently paused with no automatic way
                // to recover short of a manual tap. So: always kick off playback
                // muted (this essentially never fails), then unmute immediately
                // once it's actually playing - browsers permit toggling .muted on
                // an already-playing element, since that isn't "initiating audible
                // autoplay" the way starting playback unmuted is.
                video.defaultMuted = true;
                video.muted = true;

                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        if (idx !== activeTargetIndex) {
                            video.muted = true;
                            video.pause();
                        } else if (!isAppMuted) {
                            video.muted = false;
                            video.volume = 1.0;
                        }
                    }).catch(() => {
                        // A genuine failure (not an autoplay-policy block, since we
                        // started muted) - the self-healing watchdog below retries.
                    });
                }
                updatePlayIconVisibility(idx);
            }
        } else {
            // ADJACENT PREBUFFERED REELS (index - 1, index + 1)
            video.preload = 'auto';
            video.muted = true;
            if (!video.paused) video.pause();
            updatePlayIconVisibility(idx);
        }
    });

    loadedVideoWindow = newWindow;
    updateAllPlayIconVisibilities();
    localStorage.setItem('gre_reels_index', index);

    // SELF-HEALING WATCHDOG: fast/flicked scrolling can occasionally interrupt a
    // play() promise (AbortError) right as the target settles, leaving the video
    // silently paused with no play icon shown and no way to resume except a manual
    // tap. Verify shortly after that the settled active video is actually playing;
    // if it isn't (and the user didn't explicitly pause it), retry automatically.
    if (playWatchdogTimer) clearTimeout(playWatchdogTimer);
    playWatchdogTimer = setTimeout(() => {
        playWatchdogTimer = null;
        if (index !== currentIndex || index !== activeTargetIndex || commentsOpen) return;
        if (reelPauseStates[index]) return;
        const video = cardVideoMap.get(index);
        if (video && video.paused && video.src) {
            video.muted = true; // guaranteed-to-succeed retry; unmute once actually playing
            const retry = video.play();
            if (retry !== undefined) {
                retry.then(() => {
                    if (index === currentIndex && index === activeTargetIndex && !isAppMuted) {
                        video.muted = false;
                        video.volume = 1.0;
                    }
                }).catch(() => {});
            }
        }
        updatePlayIconVisibility(index);
    }, 500);
}

// Click to play/pause functionality
let lastTap = 0;
let lastTapX = 0;
let lastTapY = 0;
let lastTapIndex = -1;
let tapTimeout = null;
let cardDragStartY = 0;
const DRAG_THRESHOLD = 30;

let lastCommentsOpenTime = 0;
let lastImdbPopupTime = 0;
let isImdbPopupActive = false;
let suppressNextTap = false;

// True if a pointer event's coordinates fall within the open comments drawer.
function isPointerOverCommentsDrawer(e) {
    if (!commentsOpen) return false;
    const drawer = document.getElementById('comments-drawer');
    if (!drawer) return false;
    const rect = drawer.getBoundingClientRect();
    const y = e.clientY;
    return y >= rect.top && y <= rect.bottom;
}

// True if a pointer event is within 24px proximity of the action sidebar tray
function isNearActionTray(e) {
    const tray = document.querySelector('.action-tray');
    if (!tray) return false;
    const rect = tray.getBoundingClientRect();
    const pad = 24;
    const x = e.clientX;
    const y = e.clientY;
    return (x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad);
}

// --- Hold gestures: 2x-speed zones + hold-to-pause-and-hide-UI ------------
// Mobile: leftmost/rightmost 20% of the screen. Desktop: only the black
// letterbox/pillarbox bars beside the video (gestures over the actual video
// frame are reserved for the default tap/hold-to-pause interactions).
// Holding a speed zone plays at 2x and hides every UI element except the
// video and bottom nav, with a below-video disclaimer explaining the slide-
// down-to-lock/unlock gesture; releasing restores the UI. The remaining area
// (100% whenever the reel is already explicitly paused, since speed is
// meaningless then) holds for ~0.5s to temporarily pause + hide UI the same
// way. Scrolling to a new reel always resets speed back to normal; pausing
// never does.
const HOLD_EDGE_ZONE_RATIO_MOBILE = 0.20; // expanded from 10% to 20% on mobile
const HOLD_PAUSE_DELAY_MS = 180; // significantly quicker than before, while still clearly longer than a normal tap release
const DOUBLE_TAP_GUARD_MS = 300; // matches the app's existing double-tap-to-like window
const HOLD_PAUSE_MOVE_CANCEL_PX = 12;  // movement past this before the pause timer fires cancels the hold, so normal swipe-scrolling is never blocked
const HOLD_SPEED_ENGAGE_DELAY_MS = 180; // debounce so a plain quick tap/swipe never flashes the disclaimer/UI-hide or blocks scrolling
const HOLD_SPEED_LOCK_SLIDE_PX = 55;   // downward slide distance while holding to cross the lock/unlock threshold

let holdActive = false;
let holdIndex = -1;
let holdZone = null; // 'speed' | 'pause'
let holdStartX = 0;
let holdStartY = 0;
let holdStartTime = 0;
let holdTimer = null; // pause-hold threshold timer OR the speed engage-delay timer
let holdTriggered = false; // whether the hold's visible action has actually engaged
let holdPauseWasAlreadyPaused = false;
let speedLocked = false;           // persists until the active reel changes (see playActiveVideo)
let speedGestureLockAtStart = false; // was speedLocked already true when THIS hold began? (lock-direction vs unlock-direction)
let speedGestureCrossed = false;     // has the live drag position crossed the lock/unlock threshold?
let speedGestureRafHandle = null;

const LOCK_ICON_UNLOCKED_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
const LOCK_ICON_LOCKED_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

// Determines which zone a touch/click falls in. On mobile it's a simple
// percentage of screen width; on desktop it's based on the video's actual
// rendered (letterboxed) bounds, so the gesture only lives on the black bars.
function getHoldZoneForX(clientX, index) {
    const isPC = window.innerWidth >= 768;
    if (isPC) {
        const card = getCardEl(index);
        const video = card ? card.querySelector('.reel-video') : null;
        let videoAspect = 9 / 16;
        if (video && video.videoWidth && video.videoHeight) {
            videoAspect = video.videoWidth / video.videoHeight;
        }
        const videoH = window.innerHeight - 64;
        const actualVideoW = Math.min(window.innerWidth, videoH * videoAspect);
        const actualVideoLeft = (window.innerWidth - actualVideoW) / 2;
        const actualVideoRight = actualVideoLeft + actualVideoW;
        if (clientX < actualVideoLeft) return 'left';
        if (clientX > actualVideoRight) return 'right';
        return 'middle'; // over the actual video frame - reserved for default interactions
    }
    const w = window.innerWidth;
    if (clientX <= w * HOLD_EDGE_ZONE_RATIO_MOBILE) return 'left';
    if (clientX >= w * (1 - HOLD_EDGE_ZONE_RATIO_MOBILE)) return 'right';
    return 'middle';
}

function clearHoldTimer() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}

function cancelSpeedGestureFrame() {
    if (speedGestureRafHandle !== null) {
        cancelAnimationFrame(speedGestureRafHandle);
        speedGestureRafHandle = null;
    }
}

// Liquid-glass style toast, distinct from the app's regular flat toasts,
// reserved for the two speed-lock confirmations.
function showSpeedToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl text-sm font-semibold text-white pointer-events-none select-none flex items-center gap-2';
    toast.style.top = 'calc(env(safe-area-inset-top, 16px) + 2.5rem)';
    toast.style.background = 'rgba(255, 255, 255, 0.14)';
    toast.style.backdropFilter = 'blur(20px) saturate(180%)';
    toast.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.25)';
    toast.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)';
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -8px) scale(0.96)';
    toast.style.transition = 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>${message}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%, 0) scale(1)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -8px) scale(0.96)';
        setTimeout(() => toast.remove(), 250);
    }, 1500);
}

// Updates the below-video disclaimer. Passing null hides it. Only actually
// animates the text/icon swap when the label genuinely changes, so repeated
// calls with the same state are cheap no-ops (important since this can be
// invoked every animation frame while scrubbing).
function setSpeedDisclaimer(index, state) {
    const card = getCardEl(index);
    if (!card) return;
    const wrap = card.querySelector('.speed-disclaimer');
    if (!wrap) return;
    const textEl = wrap.querySelector('.speed-disclaimer-text');
    const iconEl = wrap.querySelector('.speed-disclaimer-icon');
    if (!textEl || !iconEl) return;

    if (!state) {
        wrap.style.opacity = '0';
        wrap.dataset.currentLabel = '';
        return;
    }

    const label = state.mode === 'lock'
        ? (state.crossed ? 'Release to lock 2x speed' : 'Slide down to lock 2x speed')
        : (state.crossed ? 'Release for normal speed' : 'Slide down for normal speed');
    const iconSvg = state.crossed ? LOCK_ICON_LOCKED_SVG : LOCK_ICON_UNLOCKED_SVG;

    wrap.style.opacity = '1';
    if (wrap.dataset.currentLabel === label) return;
    wrap.dataset.currentLabel = label;

    if (!textEl.textContent) {
        // First reveal for this hold - nothing to animate out yet.
        textEl.textContent = label;
        iconEl.innerHTML = iconSvg;
        return;
    }

    // Old text/icon slide down & fade out, then the new one slides down from
    // above & fades in - a quick, smooth crossfade-replace.
    textEl.style.transition = 'transform 0.11s ease-in, opacity 0.11s ease-in';
    iconEl.style.transition = 'transform 0.11s ease-in, opacity 0.11s ease-in';
    textEl.style.transform = 'translateY(8px)';
    textEl.style.opacity = '0';
    iconEl.style.transform = 'translateY(8px)';
    iconEl.style.opacity = '0';

    setTimeout(() => {
        textEl.textContent = label;
        iconEl.innerHTML = iconSvg;
        textEl.style.transition = 'none';
        iconEl.style.transition = 'none';
        textEl.style.transform = 'translateY(-8px)';
        iconEl.style.transform = 'translateY(-8px)';
        void wrap.offsetHeight; // force reflow: commit the "above" starting frame before animating in
        requestAnimationFrame(() => {
            textEl.style.transition = 'transform 0.13s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.13s ease-out';
            iconEl.style.transition = 'transform 0.13s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.13s ease-out';
            textEl.style.transform = 'translateY(0)';
            textEl.style.opacity = '1';
            iconEl.style.transform = 'translateY(0)';
            iconEl.style.opacity = '1';
        });
    }, 110);
}

function hideAllSpeedDisclaimers() {
    const indices = new Set(loadedVideoWindow);
    indices.add(currentIndex);
    indices.forEach(idx => setSpeedDisclaimer(idx, null));
}

// What the video should actually be playing at RIGHT NOW given the current
// drag position: video is ALWAYS played at 2x during the entire holding action
// (for both 2x disclaimers and normal speed disclaimers). Releasing the hold
// determines whether it stays at 2x or reverts back to 1x.
function computeLiveSpeedForGesture() {
    return 2;
}

function applySpeedGestureVisuals(index) {
    const card = getCardEl(index);
    const video = card ? card.querySelector('.reel-video') : null;
    if (video) {
        // preservesPitch is already set once in createPooledVideoElement.
        setPlaybackRate(video, computeLiveSpeedForGesture());
    }
    setSpeedDisclaimer(index, {
        mode: speedGestureLockAtStart ? 'unlock' : 'lock',
        crossed: speedGestureCrossed
    });
}

function scheduleSpeedGestureFrame(index) {
    if (speedGestureRafHandle !== null) return;
    speedGestureRafHandle = requestAnimationFrame(() => {
        speedGestureRafHandle = null;
        applySpeedGestureVisuals(index);
    });
}

function setFeedScrollDisabled(disabled) {
    // Left empty to prevent dynamic touchAction style mutations during active touch,
    // which causes WebKit video playback pipeline stutters on mobile devices.
    // Scrolling is already prevented during speed hold via the passive: false touchmove handler.
}

// Fades out (or restores) every UI element except the video itself and the
// bottom nav bar, for both hold flavors. Kept as a fast, uniform transition
// regardless of each element's own (slower) default transition, so the fade
// genuinely reads as quick.
function setCardHoldUIHidden(card, hidden) {
    if (!card) return;
    const tray = card.querySelector('.action-tray');
    const wordInfo = card.querySelector('.word-info-overlay');
    const badge = card.querySelector('.show-badge-container');
    const playCenterBtn = card.querySelector('.play-center-btn') || card.querySelector('.play-icon-center');
    const muteBtn = card.querySelector('.play-mute-btn');
    const playOverlay = card.querySelector('.play-pause-overlay');
    const dur = hidden ? '0.12s' : '0.18s';

    // Temporary hold mode (Issue 7): EVERY SINGLE UI ELEMENT (word info, badge, play icon, mute button, and ALL action tray buttons including > <) hides completely!
    const trayChildren = tray ? Array.from(tray.children) : [];

    [wordInfo, badge, playCenterBtn, muteBtn, playOverlay, ...trayChildren].forEach(el => {
        if (!el) return;
        el.style.transition = `opacity ${dur} ease-out`;
        el.style.opacity = hidden ? '0' : '';
        el.style.pointerEvents = hidden ? 'none' : '';
    });

    if (!hidden) {
        const idx = card.dataset.index !== undefined ? parseInt(card.dataset.index, 10) : currentIndex;
        updatePlayIconVisibility(idx);
    }
}

// Cancels any in-progress hold without applying its release side-effects -
// used when the active reel itself is about to change (scroll/navigation).
function cancelActiveHold() {
    clearHoldTimer();
    cancelSpeedGestureFrame();
    setFeedScrollDisabled(false);
    if (!holdActive) return;
    const idx = holdIndex;
    const zone = holdZone;
    const card = getCardEl(idx);
    if (card) setCardHoldUIHidden(card, false);
    const video = card ? card.querySelector('.reel-video') : null;
    if (zone === 'speed') {
        setSpeedDisclaimer(idx, null);
        setPlaybackRate(video, speedLocked ? 2 : 1);
    } else if (zone === 'pause' && video && !holdPauseWasAlreadyPaused && !reelPauseStates[idx]) {
        // A hold-to-pause froze the frame (rate=0) and got interrupted before
        // a normal release - restore normal playback since the user never
        // explicitly paused this reel.
        setPlaybackRate(video, (speedLocked && idx === currentIndex) ? 2 : 1);
        if (video.paused) video.play().catch(() => {});
    }
    holdActive = false;
    holdIndex = -1;
    holdZone = null;
}

function triggerHoldPause(index) {
    if (!holdActive || holdIndex !== index || holdZone !== 'pause') return;
    holdTimer = null;
    holdTriggered = true;
    const card = getCardEl(index);
    if (!card) return;
    const video = card.querySelector('.reel-video');
    // Soft-pause (rate=0) rather than a real .pause() - keeps the audio
    // session alive so releasing the hold resumes sound instantly.
    if (!holdPauseWasAlreadyPaused && video) {
        setPlaybackRate(video, 0);
    }
    setCardHoldUIHidden(card, true);
}

function triggerSpeedEngage(index) {
    if (!holdActive || holdIndex !== index || holdZone !== 'speed') return;
    holdTimer = null;
    holdTriggered = true;
    setFeedScrollDisabled(true);
    const card = getCardEl(index);
    if (card) setCardHoldUIHidden(card, true);
    applySpeedGestureVisuals(index);
}

function beginHoldGesture(e, index) {
    if (index !== currentIndex) return; // holds only apply to the currently active reel
    cancelActiveHold();

    holdActive = true;
    holdIndex = index;
    holdStartX = e.clientX;
    holdStartY = e.clientY;
    holdStartTime = Date.now();
    holdTriggered = false;

    // True while the reel is already explicitly paused - in that case EVERY
    // zone (not just the middle) resolves to the pause/hide-UI hold, since "2x
    // speed" is meaningless on a paused video. Otherwise, touch/click position
    // decides: edges = 2x-speed zone, middle = pause-and-hide zone.
    // getHoldZoneForX already branches internally on mobile (percentage of
    // screen width) vs PC (actual letterboxed video bounds), so the same call
    // is correct for both platforms - this was previously only used on PC,
    // which is why mobile ignored position and PC crashed on the undefined
    // `isPaused` reference before ever reaching this line.
    const isPaused = !!reelPauseStates[index];
    const zone = isPaused ? 'pause' : (getHoldZoneForX(e.clientX, index) === 'middle' ? 'pause' : 'speed');
    holdZone = zone;

    if (zone === 'speed') {
        // NOTE: feed scroll is intentionally NOT disabled here - only once
        // triggerSpeedEngage actually confirms this is a real hold (see below).
        // Disabling it immediately on touch-down blocked every quick swipe that
        // happened to start inside an edge zone, which is what made the reel
        // feel "locked" when the user just wanted to scroll to the next card.
        speedGestureLockAtStart = speedLocked;
        speedGestureCrossed = false;
        holdTimer = setTimeout(() => triggerSpeedEngage(index), HOLD_SPEED_ENGAGE_DELAY_MS);
    } else {
        holdPauseWasAlreadyPaused = isPaused;
        // If a previous tap's release happened moments ago, this press is very
        // likely the second tap of a double-tap-to-like gesture. Don't arm the
        // pause-hold timer for it - otherwise the (now much shorter) hold delay
        // could fire mid double-tap and swallow the like gesture entirely.
        // holdTriggered simply never becomes true, so resolveHoldGesture falls
        // through to the normal single/double-tap logic on release.
        if (Date.now() - lastTap < DOUBLE_TAP_GUARD_MS) {
            holdTimer = null;
        } else {
            holdTimer = setTimeout(() => triggerHoldPause(index), HOLD_PAUSE_DELAY_MS);
        }
    }
}

// Resolves a completed hold gesture. Returns true if the hold already fully
// handled the release (so the caller should NOT also run normal tap/swipe
// logic), or false if this was actually just a quick tap that should fall
// through to the ordinary single/double-tap handling below.
function resolveHoldGesture(index) {
    const zone = holdZone;
    const triggered = holdTriggered;
    const wasAlreadyPaused = holdPauseWasAlreadyPaused;
    const lockAtStart = speedGestureLockAtStart;
    const crossed = speedGestureCrossed;

    clearHoldTimer();
    cancelSpeedGestureFrame();
    setFeedScrollDisabled(false);
    holdActive = false;
    holdIndex = -1;
    holdZone = null;

    const card = getCardEl(index);

    if (zone === 'speed') {
        if (!triggered) return false; // released inside the short engage debounce - a plain tap

        setCardHoldUIHidden(card, false);
        setSpeedDisclaimer(index, null);
        const video = card ? card.querySelector('.reel-video') : null;

        if (!lockAtStart) {
            // Lock-direction gesture: was 2x for the whole hold either way.
            if (crossed) {
                speedLocked = true;
                setPlaybackRate(video, 2);
                showSpeedToast('Locked at 2x speed');
            } else {
                speedLocked = false;
                setPlaybackRate(video, 1);
            }
        } else {
            // Unlock-direction gesture: live-previewed 1x once crossed.
            if (crossed) {
                speedLocked = false;
                setPlaybackRate(video, 1);
                showSpeedToast('Back to normal speed');
            } else {
                speedLocked = true;
                setPlaybackRate(video, 2);
            }
        }
        return true; // an engaged hold always fully resolves - no tap fallback
    }

    // zone === 'pause'
    if (triggered) {
        if (card) setCardHoldUIHidden(card, false);
        const video = card ? card.querySelector('.reel-video') : null;
        if (!wasAlreadyPaused && video) {
            setPlaybackRate(video, (speedLocked && index === currentIndex) ? 2 : 1);
            if (video.paused) video.play().catch(() => {}); // fallback for a genuinely-paused element
        }
        return true; // a genuine hold already fired - don't also run a tap
    }

    // Released before the pause threshold - treat exactly like an ordinary tap/swipe.
    return false;
}

function onHoldPointerMove(e) {
    if (!holdActive) return;
    const dy = e.clientY - holdStartY;
    const dx = e.clientX - holdStartX;

    if (holdZone === 'speed') {
        if (!holdTriggered) {
            // Still inside the pre-engage debounce window - if this is clearly
            // turning into a swipe/scroll gesture, bail out of the pending
            // speed-hold entirely so scrolling to the next reel is never
            // blocked. Only a genuinely still hold reaches the engage timer.
            if (holdTimer && (Math.abs(dy) > HOLD_PAUSE_MOVE_CANCEL_PX || Math.abs(dx) > HOLD_PAUSE_MOVE_CANCEL_PX)) {
                clearHoldTimer();
                setFeedScrollDisabled(false);
                holdActive = false;
                holdIndex = -1;
                holdZone = null;
            }
            return;
        }
        const nowCrossed = dy > HOLD_SPEED_LOCK_SLIDE_PX && Math.abs(dx) < 70;
        if (nowCrossed !== speedGestureCrossed) {
            speedGestureCrossed = nowCrossed;
            scheduleSpeedGestureFrame(holdIndex);
        }
        return;
    }

    // Pause zone: bail out of the pending hold the moment this looks like a
    // swipe/scroll instead, so normal reel-to-reel scrolling never gets stuck.
    // Once the hold has already triggered (UI hidden / video paused), further
    // movement is ignored here - only release resolves it, so the UI never
    // gets abandoned mid-fade.
    if (!holdTriggered && holdTimer && (Math.abs(dy) > HOLD_PAUSE_MOVE_CANCEL_PX || Math.abs(dx) > HOLD_PAUSE_MOVE_CANCEL_PX)) {
        clearHoldTimer();
        holdActive = false;
        holdIndex = -1;
        holdZone = null;
    }
}

function onCardDown(e, index) {
    cardDragStartY = e.clientY;
    if (e.target.closest('#comments-drawer') || e.target.closest('#comments-drag-handle') || isPointerOverCommentsDrawer(e)) {
        commentsDragActive = true;
        return;
    }
    commentsDragActive = false;
    if (commentsOpen || isImdbPopupActive || suppressNextTap || isMuteButtonPressed || Date.now() - lastCommentsOpenTime < 300 || Date.now() - lastImdbPopupTime < 200) return;
    if (e.target.closest('button') || e.target.closest('.action-btn') || e.target.closest('.play-mute-btn') || e.target.closest('#comments-mute-btn') || e.target.closest('.word-info-overlay') || e.target.closest('.show-badge-container') || e.target.closest('#bottom-navbar') || e.target.closest('.action-tray')) return;

    beginHoldGesture(e, index);
}

function onCardUp(e, index) {
    if (commentsOpen) {
        cancelActiveHold();
        // If touch/drag started or ended on comments drawer or notch, do NOT close comments!
        if (commentsDragActive || e.target.closest('#comments-drawer') || e.target.closest('#comments-drag-handle') || isPointerOverCommentsDrawer(e)) {
            commentsDragActive = false;
            return;
        }
        // Only a clean tap on video area outside comments closes comments
        const clickDist = Math.abs(cardDragStartY - e.clientY);
        if (clickDist < 8) {
            closeComments();
        }
        commentsDragActive = false;
        return;
    }
    commentsDragActive = false;

    // Ignore if detached DOM node or within mute tap window or popup active
    // Ignore if detached DOM node or within mute/play tap window or popup active
    if (!document.body.contains(e.target) || isImdbPopupActive || suppressNextTap || isMuteButtonPressed || Date.now() - lastCommentsOpenTime < 300 || Date.now() - lastImdbPopupTime < 200 || e.target.closest('.play-mute-btn') || e.target.closest('.play-center-btn') || e.target.closest('#comments-mute-btn')) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        lastTap = 0;
        isMuteButtonPressed = false;
        cancelActiveHold();
        return;
    }
    if (e.target.closest('button') || e.target.closest('.action-btn') || e.target.closest('.play-mute-btn') || e.target.closest('.play-center-btn') || e.target.closest('#comments-mute-btn') || e.target.closest('.word-info-overlay') || e.target.closest('.show-badge-container') || e.target.closest('#bottom-navbar') || e.target.closest('#comments-drawer') || e.target.closest('.action-tray')) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        lastTap = 0;
        return;
    }

    // Resolve any active hold gesture (2x-speed edge hold, or the hold-to-pause
    // fade-out) first. If it fully handled the release, don't also run the
    // ordinary tap/swipe logic below.
    if (holdActive && holdIndex === index) {
        const handledAsHold = resolveHoldGesture(index);
        if (handledAsHold) return;
    }

    const drawer = document.getElementById('comments-drawer');
    if (drawer && !drawer.classList.contains('translate-y-full')) {
        closeComments();
        return;
    }

    const deltaY = cardDragStartY - e.clientY;
    const isPC = window.innerWidth >= 768;

    // Scroll / Swipe Guard: If finger moved > 10px vertically, treat as SCROLL/SWIPE, NOT tap!
    if (Math.abs(deltaY) > 10) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        lastTap = 0;
        lastTapIndex = -1;
        if (isPC && Math.abs(deltaY) > DRAG_THRESHOLD) {
            const feed = document.getElementById('reels-feed');
            if (feed) {
                if (deltaY > 0 && currentIndex < appData.length - 1) {
                    feed.scrollTo({ top: (currentIndex + 1) * window.innerHeight, behavior: 'smooth' });
                } else if (deltaY < 0 && currentIndex > 0) {
                    feed.scrollTo({ top: (currentIndex - 1) * window.innerHeight, behavior: 'smooth' });
                }
            }
        }
        return;
    }

    const now = Date.now();
    const x = e.clientX;
    const y = e.clientY;

    const timeDelta = now - lastTap;
    const dist = Math.hypot(x - lastTapX, y - lastTapY);

    // Double-tap to LIKE: double-tapping anywhere on the video screen (outside action buttons and play button)
    // within 280ms, on the SAME reel index, and in the SAME physical location (distance < 45px) drops a like without toggling play/pause.
    if (timeDelta < 280 && lastTapIndex === index && dist < 45) {
        if (tapTimeout) {
            clearTimeout(tapTimeout);
            tapTimeout = null;
        }
        lastTap = 0;
        lastTapIndex = -1;
        handleDoubleTapLike(e, index);
    } else {
        // Single tap: delay play/pause toggle by 220ms so a 2nd tap in the same spot turns it into a double-tap like.
        if (tapTimeout) {
            clearTimeout(tapTimeout);
            tapTimeout = null;
        }
        lastTap = now;
        lastTapX = x;
        lastTapY = y;
        lastTapIndex = index;

        tapTimeout = setTimeout(() => {
            tapTimeout = null;
            togglePlayPauseSoft(index);
        }, 220);
    }
}

// Open IMDB direct title link for a show/movie after confirmation (handles iOS native confirm pause recovery)
function openShowIMDB(e, showName) {
    if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (e.preventDefault) e.preventDefault();
    }
    isImdbPopupActive = true;
    lastImdbPopupTime = Date.now();
    suppressNextTap = true;

    const baseShowName = showName.replace(/\s*S\d+\.E\d+\.?\s*/i, '').trim();
    const ttId = (typeof IMDB_SHOW_LINKS !== 'undefined' && (IMDB_SHOW_LINKS[showName] || IMDB_SHOW_LINKS[baseShowName]));
    const directUrl = ttId
        ? (ttId.startsWith('http') ? ttId : `https://www.imdb.com/title/${ttId}`)
        : `https://www.imdb.com/find?q=${encodeURIComponent(baseShowName)}`;

    // Store reference to active video & playing state before native iOS modal interrupts
    const card = getCardEl(currentIndex);
    const video = card ? card.querySelector('.reel-video') : null;
    const wasPlayingBeforeModal = video ? !video.paused : true;

    setTimeout(() => {
        let userAccepted = false;
        try {
            userAccepted = confirm(`Open IMDB for "${showName.trim()}"?`);
            if (userAccepted) {
                window.open(directUrl, '_blank');
            }
        } finally {
            lastImdbPopupTime = Date.now();
            isImdbPopupActive = false;
            suppressNextTap = true;

            // iOS WebKit automatically pauses video playback during native confirm() modals.
            // When user taps Cancel (or closes modal), mark reel as explicitly paused and display play icon overlay!
            if (!userAccepted) {
                reelPauseStates[currentIndex] = true;
                if (video) {
                    video.pause();
                }
                updatePlayIconVisibility(currentIndex);
            }

            setTimeout(() => { suppressNextTap = false; }, 150);
        }
    }, 50);
}

// Fast single-tap play feedback
function showPlayPauseOverlay(index, isPlay) {
    updatePlayIconVisibility(index);
}

// Double tap Heart Pop & Fly Animation (GPU accelerated, ultra fast & smooth)
function handleDoubleTapLike(e, index) {
    const card = getCardEl(index);
    if (!card) return;
    const word = card.dataset.word;
    
    // Set liked state to true (double tap never unlikes)
    if (!getLikeState(word)) {
        toggleLike(null, word, index);
    }
    
    // Trigger static heart button pop ONCE on double-tap
    const likeBtn = document.getElementById(`like-btn-${index}`);
    if (likeBtn) {
        likeBtn.style.transform = 'scale(1.35)';
        likeBtn.style.transition = 'transform 0.12s ease';
        setTimeout(() => {
            likeBtn.style.transform = 'scale(1)';
        }, 120);
    }

    const rect = card.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    let destX = startX;
    let destY = startY;
    if (likeBtn) {
        const btnRect = likeBtn.getBoundingClientRect();
        destX = btnRect.left + btnRect.width / 2 - rect.left;
        destY = btnRect.top + btnRect.height / 2 - rect.top;
    }

    const deltaX = destX - startX;
    const deltaY = destY - startY;

    const heart = document.createElement('div');
    heart.style.position = 'absolute';
    heart.style.left = `${startX}px`;
    heart.style.top = `${startY}px`;
    heart.style.willChange = 'transform, opacity';
    heart.style.transform = 'translate3d(-50%, -50%, 0) scale(0.2)';
    heart.style.opacity = '0';
    heart.style.zIndex = '100';
    heart.style.pointerEvents = 'none';
    heart.style.transition = 'transform 0.14s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.14s ease-out';
    heart.innerHTML = `<svg class="w-16 h-16 text-red-500 fill-current drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    
    card.appendChild(heart);

    // Pop heart in fast
    requestAnimationFrame(() => {
        heart.style.transform = 'translate3d(-50%, -50%, 0) scale(1.3)';
        heart.style.opacity = '1';
    });

    // Fly heart into button with 60fps GPU translate transform and smoothly absorb without second bounce
    setTimeout(() => {
        heart.style.transition = 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.22s ease-in';
        heart.style.transform = `translate3d(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px), 0) scale(0.12)`;
        heart.style.opacity = '0';

        setTimeout(() => {
            heart.remove();
        }, 220);
    }, 140);
}



// Scroll / Swipe Handling using Scroll Snapping
let scrollTimeout = null;// Saved reel progress helper
function updateSavedReelIndex(idx) {
    const feedData = getActiveFeed();
    if (feedData.length === 0) {
        currentIndex = 0;
        return;
    }
    currentIndex = (idx >= 0 && idx < feedData.length) ? idx : 0;
    if (activeFeedMode === 'all') {
        localStorage.setItem('gre_reels_index', currentIndex);
        if (feedData[currentIndex]) {
            localStorage.setItem('gre_reels_word', feedData[currentIndex].word);
        }
    }
}

function getResumeIndex(requestedIndex) {
    const feedData = getActiveFeed();
    if (feedData.length === 0) return 0;

    if (typeof requestedIndex === 'number' && !isNaN(requestedIndex) && requestedIndex >= 0 && requestedIndex < feedData.length) {
        return requestedIndex;
    }

    if (activeFeedMode === 'all') {
        // 1. If latest reel is imported, start from it
        const savedWord = localStorage.getItem('gre_reels_word');
        if (savedWord) {
            const foundWordIdx = feedData.findIndex(w => w.word === savedWord);
            if (foundWordIdx !== -1) return foundWordIdx;
        }

        // 2. If target reel is not imported, start from the reel originally below it
        const savedIndex = parseInt(localStorage.getItem('gre_reels_index')) || 0;
        if (savedIndex >= 0 && savedIndex < feedData.length) {
            return savedIndex;
        }

        // Search for next available imported reel at or after savedIndex
        for (let i = savedIndex; i < feedData.length; i++) {
            if (feedData[i]) return i;
        }
    }

    // 3. Fallback to beginning (0)
    return 0;
}

let isProgrammaticScroll = false;
let reelsObserver = null;

// IntersectionObserver feed scroll engine for Instagram/TikTok grade feed stability
function setupScrollListener() {
    const feed = document.getElementById('reels-feed');
    if (!feed) return;

    if (reelsObserver) {
        reelsObserver.disconnect();
        reelsObserver = null;
    }

    const observerOptions = {
        root: feed,
        threshold: 0.65 // Card must be 65% visible in viewport to trigger active reel change
    };

    reelsObserver = new IntersectionObserver((entries) => {
        if (isProgrammaticScroll || feed.classList.contains('hidden') || feed.offsetHeight === 0) return;

        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const idx = parseInt(card.dataset.index, 10);
                const feedData = getActiveFeed();
                if (!isNaN(idx) && idx >= 0 && idx < feedData.length && idx !== currentIndex) {
                    // Hydrate immediately (not debounced): this only ever swaps a
                    // couple of placeholder<->full cards near the edge of the
                    // window, so it's cheap regardless of scroll speed, and it's
                    // what keeps the card's buttons/word/def already in place
                    // (instead of teleporting in) by the time it's visible.
                    hydrateWindow(idx);

                    // Close the comments drawer right away (cheap: touches a single card),
                    // but debounce the actual video switch below so that flicking quickly
                    // past several reels doesn't fire an overlapping play()/pause() call
                    // for every intermediate card - only the reel the scroll actually
                    // settles on ends up calling play(). This is what prevents a reel
                    // from landing paused (needing a manual tap) after a fast swipe.
                    if (commentsOpen) closeComments();

                    if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
                    scrollSettleTimer = setTimeout(() => {
                        scrollSettleTimer = null;
                        if (idx === currentIndex) return;
                        updateSavedReelIndex(idx);
                        reelPauseStates[idx] = false;
                        playActiveVideo(idx);
                    }, SCROLL_SETTLE_DELAY);
                }
            }
        });
    }, observerOptions);

    const cards = feed.querySelectorAll('.reel-card');
    cards.forEach(card => reelsObserver.observe(card));
}

// State Accessors (likes, bookmarks, learned) using local storage with debounce lock & key normalization
const actionDebounceLocks = {};

function isActionLocked(key) {
    const now = Date.now();
    if (actionDebounceLocks[key] && now - actionDebounceLocks[key] < 350) {
        return true;
    }
    actionDebounceLocks[key] = now;
    return false;
}

function getLikeState(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return false;
    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    return !!(likes[clean] || likes[word]);
}

function toggleLike(e, word, index) {
    if (e) e.stopPropagation();
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return;
    if (isActionLocked(`lk_${clean}_${index}`)) return;

    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    const existingKey = likes[clean] !== undefined ? clean : (likes[word] !== undefined ? word : clean);
    likes[existingKey] = !likes[existingKey];
    localStorage.setItem('gre_reels_likes', JSON.stringify(likes));

    const btn = document.getElementById(`like-btn-${index}`);
    const countEl = document.getElementById(`like-count-${index}`);
    if (btn && countEl) {
        const isLiked = likes[existingKey];
        btn.innerHTML = `<svg class="w-[33px] h-[33px]" fill="${isLiked ? '#ef4444' : 'none'}" stroke="${isLiked ? '#ef4444' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
        </svg>`;
        const baseLikes = parseInt(countEl.getAttribute('data-base')) || 0;
        countEl.textContent = isLiked ? baseLikes + 1 : baseLikes;
    }
    updateHomeStats();
}

function getBookmarkState(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return false;
    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    return !!(saved[clean] || saved[word]);
}

function toggleBookmark(e, word, index) {
    if (e) e.stopPropagation();
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return;
    if (isActionLocked(`bm_${clean}_${index}`)) return;

    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    const existingKey = saved[clean] ? clean : (saved[word] ? word : null);
    const isBookmarked = !existingKey;

    if (existingKey) {
        delete saved[existingKey];
        if (saved[clean]) delete saved[clean];
    } else {
        const feedData = getActiveFeed();
        const wordObj = feedData[index] || findWordObject(clean);
        saved[clean] = [{
            showKey: "Reels PWA",
            sentence: (wordObj && wordObj.example) || "No sentence context recorded."
        }];
    }
    localStorage.setItem('greSelectedLines', JSON.stringify(saved));

    const btn = document.getElementById(`bookmark-btn-${index}`);
    if (btn) {
        btn.innerHTML = `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px]" fill="${isBookmarked ? '#ffffff' : 'none'}" stroke="${isBookmarked ? '#ffffff' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
        </svg>`;
    }
    updateHomeStats();
}

function getLearnedState(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return false;
    const learned = JSON.parse(localStorage.getItem('learned-words')) || [];
    return learned.some(w => String(w || '').trim().toLowerCase() === clean);
}

function getLearnedWords() {
    return JSON.parse(localStorage.getItem('learned-words')) || [];
}

function toggleLearned(e, word, index) {
    if (e) e.stopPropagation();
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return;
    if (isActionLocked(`ln_${clean}_${index}`)) return;

    let learned = JSON.parse(localStorage.getItem('learned-words')) || [];
    const isLearned = learned.some(w => String(w || '').trim().toLowerCase() === clean);

    if (isLearned) {
        learned = learned.filter(w => String(w || '').trim().toLowerCase() !== clean);
    } else {
        learned.push(clean);
    }
    localStorage.setItem('learned-words', JSON.stringify(learned));

    const btn = document.getElementById(`learned-btn-${index}`);
    if (btn) {
        const nextLearned = !isLearned;
        btn.innerHTML = nextLearned 
             ? `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="white" stroke="white" stroke-width="1.6"></circle>
                    <path stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"></path>
                </svg>`
             : `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"></path>
                </svg>`;
    }
    updateHomeStats();
}

// Custom Premium Toast Notification System
function showToast(message, type) {
    const toast = document.createElement('div');
    const colors = type === 'success'
        ? 'bg-emerald-600 text-white'
        : type === 'error'
            ? 'bg-rose-600 text-white'
            : 'bg-slate-700 dark:bg-neutral-800 text-white';
    toast.className = 'fixed left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-2xl text-xs font-semibold pointer-events-none ' + colors;
    toast.style.top = 'calc(env(safe-area-inset-top, 16px) + 2.5rem)';
    toast.textContent = message;
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '1';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}

// Helper to escape regex special characters
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Drawer Comments / Context Open-Close Logic
function openComments(e, index) {
    if (e) e.stopPropagation();
    commentsCardIndex = index;
    const drawer = document.getElementById('comments-drawer');
    const navbar = document.getElementById('bottom-navbar');
    
    // Load custom context data
    const feedData = getActiveFeed();
    const wordObj = feedData[index] || findWordObject(feedData[index]?.word || '');
    const content = document.getElementById('comments-content-list');
    
    // Seeded random number generators for likes
    function seededRandom(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return () => {
            let x = Math.sin(hash++) * 10000;
            return x - Math.floor(x);
        };
    }
    
    const rand1 = seededRandom(wordObj.word + "val1");
    const rand2 = seededRandom(wordObj.word + "val2");
    const rand3 = seededRandom(wordObj.word + "val3");
    
    const isPC = window.innerWidth >= 768;
    const likeStyle = isPC ? 'font-size: 20px !important; line-height: 1.2 !important;' : 'font-size: 12px !important;';

    let commentsHtml = '';
    
    // 1. Definition Comment
    if (wordObj.def) {
        const greLikes = Math.floor(rand1() * 41) + 20;
        const greKey = wordObj.word + '_def';
        const greLiked = !!doomscrollTempLikes[greKey];
        const greDisplay = greLiked ? greLikes + 1 : greLikes;
        const greBtnClass = greLiked ? 'text-red-500 focus:outline-none focus:ring-0' : 'text-slate-400 focus:outline-none focus:ring-0';
        const greFill = greLiked ? 'currentColor' : 'none';
        
        commentsHtml += `
        <div class="flex items-start justify-between gap-3 text-xs">
            <div class="flex items-start gap-3 w-full">
                <!-- Avatar -->
                <div class="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs shrink-0 select-none">
                    G
                </div>
                <!-- Content -->
                <div class="flex flex-col flex-grow">
                    <div class="text-slate-800 dark:text-neutral-200">
                        <span class="font-bold text-[14px] mr-1 text-slate-900 dark:text-white">@gre_essential</span>
                        <svg class="w-3.5 h-3.5 inline text-blue-500 fill-current mr-1.5 relative -translate-y-[1px]" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        
                        <!-- Simple word card "image" mockup -->
                        <div class="my-2.5 p-4 rounded-xl border border-slate-200/60 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900/60 flex flex-col items-center justify-center text-center md:items-start md:justify-start md:text-left shadow-sm select-none">
                            <span class="text-xl font-serif font-black text-slate-800 dark:text-white lowercase tracking-wide">${wordObj.word}</span>
                            <span class="text-[11px] text-slate-450 dark:text-neutral-500 italic mt-0.5 lowercase">${wordObj.type}</span>
                        </div>
                        
                        <p class="leading-relaxed mt-2 text-[14.5px] text-slate-700 dark:text-neutral-300">${wordObj.def}</p>
                    </div>
                    <!-- Footer Actions (2w & Reply 10% bigger) -->
                    <div class="flex items-center gap-3 text-[11px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Mobile: 19px/12px, PC: 28.5px/24px [2x mobile]) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${greBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${greKey}">
                    <svg class="w-[19px] h-[19px] md:w-[28.5px] md:h-[28.5px]" fill="${greFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="like-count font-mono text-slate-400 dark:text-neutral-500 mt-0.5" style="${likeStyle}" data-base="${greLikes}">${greDisplay}</span>
            </div>
        </div>`;
    }
    
    // 2. Example Sentence Comment
    if (wordObj.example) {
        let regex = new RegExp("(" + escapeRegExp(wordObj.word) + "[a-zA-Z]*)", "gi");
        let highlightedEx = wordObj.example.replace(regex, (match) => `<strong class="font-bold text-teal-600 dark:text-teal-400">${match}</strong>`);
        
        const exLikes = Math.floor(rand2() * 11) + 5;
        const exKey = wordObj.word + '_ex';
        const exLiked = !!doomscrollTempLikes[exKey];
        const exDisplay = exLiked ? exLikes + 1 : exLikes;
        const exBtnClass = exLiked ? 'text-red-500 focus:outline-none focus:ring-0' : 'text-slate-400 focus:outline-none focus:ring-0';
        const exFill = exLiked ? 'currentColor' : 'none';
        
        commentsHtml += `
        <div class="flex items-start justify-between gap-3 text-xs">
            <div class="flex items-start gap-3 w-full">
                <!-- Avatar -->
                <div class="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 flex items-center justify-center font-bold text-xs shrink-0 select-none">
                    E
                </div>
                <!-- Content -->
                <div class="flex flex-col flex-grow">
                    <div class="text-slate-800 dark:text-neutral-200 flex items-center gap-1.5 flex-wrap">
                        <span class="font-bold text-[14px] text-slate-900 dark:text-white">@example_sentence</span>
                        <svg class="w-[11px] h-[11px] text-red-500 fill-current inline-block" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                        <span class="text-[11px] text-slate-400 dark:text-neutral-500">by author</span>
                    </div>
                    <p class="leading-relaxed mt-1 text-[14.5px] text-slate-700 dark:text-neutral-300">${highlightedEx}</p>
                    <!-- Footer Actions (2w & Reply 10% bigger) -->
                    <div class="flex items-center gap-3 text-[11px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Mobile: 19px/12px, PC: 28.5px/24px [2x mobile]) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${exBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${exKey}">
                    <svg class="w-[19px] h-[19px] md:w-[28.5px] md:h-[28.5px]" fill="${exFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="like-count font-mono text-slate-400 dark:text-neutral-500 mt-0.5" style="${likeStyle}" data-base="${exLikes}">${exDisplay}</span>
            </div>
        </div>`;
    }
    
    // 3. Long Example Comment
    if (wordObj.long_example) {
        let regex = new RegExp("(" + escapeRegExp(wordObj.word) + "[a-zA-Z]*)", "gi");
        let highlightedLong = wordObj.long_example.replace(regex, (match) => `<strong class="font-bold text-teal-600 dark:text-teal-400">${match}</strong>`);
        
        const longLikes = Math.floor(rand3() * 11) + 5;
        const longKey = wordObj.word + '_long';
        const longLiked = !!doomscrollTempLikes[longKey];
        const longDisplay = longLiked ? longLikes + 1 : longLikes;
        const longBtnClass = longLiked ? 'text-red-500 focus:outline-none focus:ring-0' : 'text-slate-400 focus:outline-none focus:ring-0';
        const longFill = longLiked ? 'currentColor' : 'none';
        
        commentsHtml += `
        <div class="flex items-start justify-between gap-3 text-xs">
            <div class="flex items-start gap-3 w-full">
                <!-- Avatar -->
                <div class="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold text-xs shrink-0 select-none">
                    L
                </div>
                <!-- Content -->
                <div class="flex flex-col flex-grow">
                    <div class="text-slate-800 dark:text-neutral-200 flex items-center gap-1.5 flex-wrap">
                        <span class="font-bold text-[14px] text-slate-900 dark:text-white">@long_example</span>
                        <svg class="w-[11px] h-[11px] text-red-500 fill-current inline-block" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                        <span class="text-[11px] text-slate-400 dark:text-neutral-500">by author</span>
                    </div>
                    <p class="leading-relaxed mt-1 text-[14.5px] text-slate-700 dark:text-neutral-300">${highlightedLong}</p>
                    <!-- Footer Actions (2w & Reply 10% bigger) -->
                    <div class="flex items-center gap-3 text-[11px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Mobile: 19px/12px, PC: 28.5px/24px [2x mobile]) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${longBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${longKey}">
                    <svg class="w-[19px] h-[19px] md:w-[28.5px] md:h-[28.5px]" fill="${longFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="like-count font-mono text-slate-400 dark:text-neutral-500 mt-0.5" style="${likeStyle}" data-base="${longLikes}">${longDisplay}</span>
            </div>
        </div>`;
    }
    
    content.innerHTML = commentsHtml || '<p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No context available.</p>';
    
    commentsOpen = true;
    updatePlayIconVisibility(index);
    document.body.classList.add('comments-open');
    drawer.style.visibility = 'visible';
    drawer.classList.remove('invisible');

    // Force synchronous layout flush after innerHTML insertion
    void content.offsetHeight;
    void drawer.offsetHeight;

    const isSafariNonWebapp = document.documentElement.classList.contains('safari-non-webapp');
    const pcRatio = isSafariNonWebapp ? 0.473 : 0.46;
    const expectedPCDrawerH = window.innerHeight * pcRatio;
    
    const getRealDrawerTop = () => {
        const h = drawer.offsetHeight || drawer.getBoundingClientRect().height;
        if (h && h > 100) {
            return Math.max(150, window.innerHeight - h);
        }
        return Math.max(150, window.innerHeight - (isPC ? expectedPCDrawerH : (window.innerHeight * 0.44)));
    };

    const targetTop = getRealDrawerTop();

    // Open Comments drawer and hide bottom navbar immediately (fast opening, raised fully upright)
    drawer.style.transition = 'transform 0.18s cubic-bezier(0, 0, 0.2, 1)';
    drawer.style.transform = 'translateY(0px)';
    drawer.classList.remove('translate-y-full');
    navbar.classList.add('translate-y-full');
    // Set comments drawer max-height dynamically: 45.5vh for PWA, 34.9vh for Safari non-webapp
    const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isPC) {
        drawer.style.setProperty('max-height', isPWA ? '45.5vh' : '34.9vh', 'important');
    }
    
    // Position & show floating comments mute button right above top edge of comments drawer after layout paint
    requestAnimationFrame(() => {
        const commentsMuteBtn = document.getElementById('comments-mute-btn');
        if (commentsMuteBtn) {
            const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
            const expectedMobileH = isPWA ? (window.innerHeight * 0.455) : (window.innerHeight * 0.35);
            const measuredH = drawer.getBoundingClientRect().height;
            const realH = (measuredH && measuredH > 50) ? measuredH : (drawer.offsetHeight || expectedMobileH);
            const btnBottom = realH + 12;
            commentsMuteBtn.style.setProperty('bottom', `${btnBottom}px`, 'important');
            commentsMuteBtn.style.setProperty('opacity', '1.0', 'important');
            commentsMuteBtn.style.setProperty('pointer-events', 'auto', 'important');
        }
    });

    // Shift active reel on PC (resizes video container height) and Mobile (translates Y)
    const card = getCardEl(index);
    if (card) {
        card.classList.add('comments-active');
        const overlay = card.querySelector('.word-info-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1), transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            overlay.style.transform = 'translate3d(-85px, 0, 0)';
            setTimeout(() => {
                if (commentsOpen && overlay) overlay.style.visibility = 'hidden';
            }, 300);
        }
        const container = card.querySelector('.reel-video-container') || card.firstElementChild;
        const video = card.querySelector('.reel-video');
        const fallback = card.querySelector('.audio-fallback');
        if (isPC) {
            if (container) {
                const applyHeight = () => {
                    const top = getRealDrawerTop();
                    container.style.transition = 'height 0.18s cubic-bezier(0, 0, 0.2, 1)';
                    container.style.setProperty('height', `${top}px`, 'important');
                    container.style.setProperty('max-height', `${top}px`, 'important');
                };
                applyHeight();
                requestAnimationFrame(applyHeight);
                setTimeout(applyHeight, 190);
            }
        } else {
            const target = video || fallback;
            if (target) {
                target.style.transition = 'transform 0.18s cubic-bezier(0, 0, 0.2, 1)';
                target.style.transformOrigin = 'center center';
                target.style.setProperty('transform', `translate3d(0, ${getOpenVideoShiftY()}, 0)`, 'important');
            }
        }
    }

    // Lock reels feed scrolling
    const feed = document.getElementById('reels-feed');
    if (feed) {
        feed.style.overflowY = 'hidden';
    }
}

// Calculate open video translateY shift (PWA: -25vh, Safari non-webapp: -16vh [80% of 5vh reduction applied])
function getOpenVideoShiftY() {
    const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isPC = window.innerWidth >= 768;
    if (isPC) return '-16vh';
    if (isPWA) return 'calc(-25vh + env(safe-area-inset-top, 16px))';
    return 'calc(-16vh + env(safe-area-inset-top, 16px))';
}

// Calculate exact scale factor so video bottom touches comments drawer top with 0px gap without violating top safe areas
function getExactScaleForDrawer() {
    const drawer = document.getElementById('comments-drawer');
    if (!drawer) return 0.54;
    
    const screenH = window.innerHeight;
    const drawerRect = drawer.getBoundingClientRect();
    const drawerHeight = (drawerRect && drawerRect.height > 0) ? drawerRect.height : (drawer.offsetHeight || screenH * 0.44);
    const drawerTop = screenH - drawerHeight;

    const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const topMargin = isPWA ? 44 : 20;
    const availableH = Math.max(100, drawerTop - topMargin);
    
    // Scale needed so bottom edge of top-aligned video touches drawer top line exactly (0px gap)
    const exactScale = Math.min(0.95, Math.max(0.35, availableH / (screenH - 64)));
    return exactScale;
}

// Toggle Doomscroll Comment Like
function toggleDoomscrollCommentLike(btn) {
    const key = btn.getAttribute('data-like-key');
    const isLiked = !doomscrollTempLikes[key];
    doomscrollTempLikes[key] = isLiked;
    
    const svg = btn.querySelector('svg');
    const span = btn.nextElementSibling;
    const baseLikes = parseInt(span.getAttribute('data-base')) || 0;
    
    if (isLiked) {
        btn.className = 'text-red-500 focus:outline-none focus:ring-0';
        svg.setAttribute('fill', 'currentColor');
        span.textContent = baseLikes + 1;
    } else {
        btn.className = 'text-slate-400 focus:outline-none focus:ring-0';
        svg.setAttribute('fill', 'none');
        span.textContent = baseLikes;
    }
}

function closeComments(fast) {
    const drawer = document.getElementById('comments-drawer');
    const navbar = document.getElementById('bottom-navbar');
    commentsOpen = false;
    const durationMs = fast ? 140 : 220;
    const durationCss = `${durationMs / 1000}s`;

    // Immediately hide floating comments mute button
    const commentsMuteBtn = document.getElementById('comments-mute-btn');
    if (commentsMuteBtn) {
        commentsMuteBtn.style.opacity = '0';
        commentsMuteBtn.style.pointerEvents = 'none';
    }

    // Immediately remove comments-open so buttons and word info return INSTANTLY with fast smooth anim!
    document.body.classList.remove('comments-open');
    // Only the single card that actually opened comments ever got the 'comments-active'
    // class / had its styles touched, so only that one needs to be reverted here.
    // Looping over every imported clip (as this used to do) is what caused the ~1s
    // freeze on close once dozens/hundreds of clips were imported.
    const c = getCardEl(commentsCardIndex !== -1 ? commentsCardIndex : currentIndex);
    if (c) {
        const isPCNow = window.innerWidth >= 768;
        const video = !isPCNow ? c.querySelector('.reel-video') : null;

        // Mobile only: freeze the video's exact current on-screen position as
        // an explicit inline transform, then force a style flush, BEFORE
        // removing the comments-active class or touching the transition.
        // Without this, removing the class (whose own !important transform
        // rule stops applying) and re-animating in the same tick could get
        // collapsed/reordered by the browser into two visible snaps instead
        // of one continuous slide - this pins down a known-good starting
        // frame so there's exactly one smooth animation to the closed state.
        if (video) {
            const computedTransform = window.getComputedStyle(video).transform;
            if (computedTransform && computedTransform !== 'none') {
                video.style.setProperty('transform', computedTransform, 'important');
            }
            video.style.transition = 'none';
            void video.offsetHeight; // force reflow: commit the frozen frame before animating away from it
        }

        c.classList.remove('comments-active');
        const overlay = c.querySelector('.word-info-overlay');
        if (overlay) {
            overlay.style.visibility = 'visible';
            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1), transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            overlay.style.removeProperty('opacity');
            overlay.style.removeProperty('transform');
            overlay.style.removeProperty('pointer-events');
            setTimeout(() => {
                if (!commentsOpen && overlay) overlay.style.removeProperty('transition');
            }, 300);
        }
        const container = c.querySelector('.reel-video-container') || c.firstElementChild;
        if (container) {
            container.style.transition = `height ${durationCss} cubic-bezier(0.16, 1, 0.3, 1)`;
            container.style.removeProperty('height');
            container.style.removeProperty('max-height');
        }
        if (video) {
            // One more frame so the browser has definitely painted the frozen
            // starting position before we kick off the real transition.
            requestAnimationFrame(() => {
                const isSafariNonWebapp = document.documentElement.classList.contains('safari-non-webapp');
                video.style.transition = `transform ${durationCss} cubic-bezier(0.16, 1, 0.3, 1)`;
                video.style.setProperty('transform', isSafariNonWebapp ? 'translateY(-12.2vh)' : 'translate3d(0, 0, 0)', 'important');
                video.style.removeProperty('will-change');
            });
        }
        setTimeout(() => {
            if (!commentsOpen) {
                if (container) container.style.removeProperty('transition');
                if (video) {
                    video.style.removeProperty('transition');
                    video.style.removeProperty('transform');
                }
            }
        }, durationMs + 60);
    }
    commentsCardIndex = -1;

    // Ensure navbar auto-hiding state is strictly restored on PC Reels mode
    const isPC = window.innerWidth >= 768;
    if (isPC && currentTab === 'reels') {
        hideNavbarOnPCReels();
    } else if (navbar) {
        navbar.classList.remove('translate-y-full');
    }

    // Update play icon visibility immediately
    updatePlayIconVisibility(currentIndex);

    // Slide comments drawer down
    drawer.style.transition = `transform ${durationCss} cubic-bezier(0.16, 1, 0.3, 1)`;
    drawer.classList.add('translate-y-full');
    drawer.style.transform = '';

    // Hide drawer element after slide animation finishes
    setTimeout(() => {
        if (!commentsOpen) {
            drawer.style.visibility = 'hidden';
            drawer.classList.add('invisible');
        }
    }, durationMs);

    // Reset comments list scroll position to top
    const content = document.getElementById('comments-content-list');
    if (content) {
        content.scrollTop = 0;
    }

    // Restore reels feed scrolling
    const feed = document.getElementById('reels-feed');
    if (feed) {
        feed.style.overflowY = 'scroll';
    }
}

// Dead Simple PC Reels Auto-Hiding Navbar (PC ONLY)
function hideNavbarOnPCReels() {
    const navbar = document.getElementById('bottom-navbar');
    if (!navbar) return;
    if (window.innerWidth < 768 || currentTab !== 'reels') return;
    navbar.classList.add('translate-y-full');
    document.body.classList.add('navbar-hidden');
    updateDefinitionMaxWidths();
}

function showNavbarOnPCReels() {
    const navbar = document.getElementById('bottom-navbar');
    if (!navbar || commentsOpen) return;
    if (window.innerWidth >= 768 && currentTab === 'reels') {
        navbar.classList.remove('translate-y-full');
        document.body.classList.remove('navbar-hidden');
        updateDefinitionMaxWidths();
    }
}

function initPCNavbarHoverListeners() {
    const navbar = document.getElementById('bottom-navbar');
    if (!navbar) return;

    navbar.addEventListener('mouseenter', () => {
        if (commentsOpen) return;
        showNavbarOnPCReels();
    });
    navbar.addEventListener('mouseleave', () => {
        if (commentsOpen) return;
        hideNavbarOnPCReels();
    });

    // Mousemove listener: show navbar ONLY when mouse Y is near screen bottom on PC Reels mode
    window.addEventListener('mousemove', (e) => {
        if (window.innerWidth < 768 || currentTab !== 'reels' || commentsOpen) return;
        
        // Hover detection zone: bottom 20% of screen
        const isNearBottom = e.clientY >= (window.innerHeight * 0.8);
        if (isNearBottom) {
            showNavbarOnPCReels();
        } else if (!navbar.contains(e.target)) {
            hideNavbarOnPCReels();
        }
    });
}

// Make Comments Drawer draggable downwards (notch ONLY moves down to close/reveal video)
function makeDrawerDraggable() {
    const handle = document.getElementById('comments-drag-handle');
    const drawer = document.getElementById('comments-drawer');
    const contentList = document.getElementById('comments-content-list');
    if (!handle || !drawer) return;

    // A fast flick closes immediately regardless of distance travelled; a slow
    // drag only closes once it clears the halfway point, and anything short
    // of that snaps right back open instead of hanging in a half-open state.
    const FAST_VELOCITY_PX_MS = 0.55;
    const CLOSE_DISTANCE_RATIO = 0.5;
    const FAST_CLOSE_DURATION_S = 0.16;
    const SNAP_BACK_DURATION_S = 0.16;

    let isDragging = false;
    let dragSource = null; // 'handle' | 'content'
    let pendingContentDrag = false; // pointer went down on an already-top-scrolled content list, waiting to see if it turns into a downward drag
    let startY = 0;
    let currentY = 0;
    let initialDrawerH = 0;
    let velocitySamples = [];

    // rAF-batched DOM writes: touch/mouse move events can fire irregularly, so
    // writing on every single event (as before) could visibly step between
    // positions on some devices. Buffering the latest position and only
    // committing it once per animation frame keeps the video's follow-along
    // shift perfectly continuous instead of discrete.
    let rafHandle = null;
    let latestClampedDelta = 0;

    function now() {
        return (window.performance && performance.now) ? performance.now() : Date.now();
    }

    function recordVelocitySample(y) {
        const t = now();
        velocitySamples.push({ t, y });
        while (velocitySamples.length > 2 && t - velocitySamples[0].t > 80) {
            velocitySamples.shift();
        }
    }

    function currentVelocity() {
        if (velocitySamples.length < 2) return 0;
        const first = velocitySamples[0];
        const last = velocitySamples[velocitySamples.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0) return 0;
        return (last.y - first.y) / dt; // px/ms, positive = moving down
    }

    function activeVideoTarget(activeCard) {
        if (!activeCard) return null;
        return activeCard.querySelector('.reel-video') || activeCard.querySelector('.audio-fallback');
    }

    // Reflects whether "there's no room left to scroll" on the content list
    // (i.e. it's already at the top) as a grab cursor, so PC users get the
    // same visual hint mobile gets implicitly from the drag gesture itself.
    function updateContentCursor() {
        if (!contentList || isDragging) return;
        contentList.style.cursor = (commentsOpen && contentList.scrollTop <= 0) ? 'grab' : '';
    }

    const beginDrag = (y, source) => {
        isDragging = true;
        dragSource = source || 'handle';
        startY = y;
        currentY = y;
        velocitySamples = [];
        recordVelocitySample(y);
        drawer.style.transition = 'none';
        handle.classList.add('notch-active');
        if (contentList && dragSource === 'content') {
            contentList.style.cursor = 'grabbing';
        }

        initialDrawerH = drawer.offsetHeight || (window.innerHeight * 0.46);

        // Ensure bottom navbar remains completely hidden on PC while comments section is active
        const navbar = document.getElementById('bottom-navbar');
        if (navbar && commentsOpen) {
            navbar.classList.add('translate-y-full');
            document.body.classList.add('navbar-hidden');
        }

        const activeCard = getCardEl(currentIndex);
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeVideoTarget(activeCard);
        if (container) container.style.transition = 'none';
        if (video) {
            video.style.transition = 'none';
            // GPU-accelerate the drag-follow shift so it stays butter smooth.
            video.style.willChange = 'transform';
        }
    };

    const onStart = (e) => {
        beginDrag(e.touches ? e.touches[0].clientY : e.clientY, 'handle');
    };

    // A pointer-down starting inside the comment list only becomes a
    // drawer-drag once (a) the list is already scrolled all the way to the
    // top - i.e. there's no room left to scroll - and (b) the very first bit
    // of movement is downward. Anything else (list not at top, or dragging
    // up) is left completely alone so normal list scrolling keeps working.
    // Works via touch (mobile) and mouse (PC), so the same gesture is
    // available everywhere, not just on the notch.
    const onContentDragCandidateStart = (y) => {
        if (!commentsOpen || !contentList) return;
        if (contentList.scrollTop > 0) { pendingContentDrag = false; return; }
        pendingContentDrag = true;
        startY = y;
    };
    const onContentTouchStart = (e) => onContentDragCandidateStart(e.touches ? e.touches[0].clientY : e.clientY);
    const onContentMouseDown = (e) => onContentDragCandidateStart(e.clientY);

    function applyMoveFrame() {
        rafHandle = null;
        const clampedDelta = latestClampedDelta;

        drawer.style.transform = `translate3d(0, ${clampedDelta}px, 0)`;

        const isPC = window.innerWidth >= 768;
        const activeCard = getCardEl(currentIndex);
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeVideoTarget(activeCard);

        if (isPC) {
            if (container) {
                const currentVisibleH = Math.min(window.innerHeight, Math.max(150, (window.innerHeight - initialDrawerH) + clampedDelta));
                container.style.setProperty('height', `${currentVisibleH}px`, 'important');
                container.style.setProperty('max-height', `${currentVisibleH}px`, 'important');
            }
        } else if (video) {
            const drawerHeight = initialDrawerH || (window.innerHeight * 0.44);
            const remainingRatio = Math.max(0, 1 - clampedDelta / drawerHeight);
            video.style.transformOrigin = 'center center';
            video.style.setProperty('transform', `translate3d(0, calc(${getOpenVideoShiftY()} * ${remainingRatio}), 0)`, 'important');
        }

        // Update floating comments mute button position & opacity smoothly as drawer is dragged down/up
        const commentsMuteBtn = document.getElementById('comments-mute-btn');
        if (commentsMuteBtn) {
            const drawerH = initialDrawerH || (drawer.getBoundingClientRect().height || drawer.offsetHeight || (window.innerHeight * 0.45));
            const btnBottom = Math.max(0, drawerH - clampedDelta + 12);
            commentsMuteBtn.style.setProperty('bottom', `${btnBottom}px`, 'important');

            const dragRatio = Math.min(1, Math.max(0, clampedDelta / drawerH));
            // Opacity scales linearly from 1.0 down to 0.0 (100% transparent-invisible at bottom)
            const opacity = Math.max(0, 1.0 - dragRatio);
            commentsMuteBtn.style.opacity = opacity.toFixed(2);
            commentsMuteBtn.style.pointerEvents = opacity < 0.05 ? 'none' : 'auto';
        }
    }

    function scheduleMoveFrame(clampedDelta) {
        latestClampedDelta = clampedDelta;
        if (rafHandle === null) {
            rafHandle = requestAnimationFrame(applyMoveFrame);
        }
    }

    const onMove = (e) => {
        const y = e.touches ? e.touches[0].clientY : e.clientY;

        if (pendingContentDrag && !isDragging) {
            if (contentList && contentList.scrollTop > 0) { pendingContentDrag = false; return; }
            const delta = y - startY;
            if (delta <= 0) return; // still just resting / scrolling up - not a close gesture
            pendingContentDrag = false;
            beginDrag(startY, 'content');
        }

        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        currentY = y;
        recordVelocitySample(y);
        const delta = currentY - startY;
        scheduleMoveFrame(Math.max(0, delta));
    };

    const onEnd = () => {
        pendingContentDrag = false;
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('notch-active');
        if (rafHandle !== null) {
            // Flush the very latest tracked position synchronously instead of
            // just discarding it, so the close/snap-back animation always
            // starts from exactly where the pointer was actually released -
            // never from a frame that's up to ~16ms stale.
            cancelAnimationFrame(rafHandle);
            rafHandle = null;
            applyMoveFrame();
        }

        const activeCard = getCardEl(currentIndex);
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeVideoTarget(activeCard);

        const delta = currentY - startY;
        const clampedDelta = Math.max(0, delta);
        const velocity = currentVelocity();
        const distanceRatio = initialDrawerH > 0 ? clampedDelta / initialDrawerH : 0;
        const shouldClose = clampedDelta > 0 && (velocity > FAST_VELOCITY_PX_MS || distanceRatio > CLOSE_DISTANCE_RATIO);

        if (shouldClose) {
            // Quick flick or past-halfway drag -> close fast & smoothly.
            drawer.style.transition = `transform ${FAST_CLOSE_DURATION_S}s cubic-bezier(0.16, 1, 0.3, 1)`;
            closeComments(true);
        } else {
            // Anything short of halfway (and not a fast flick) refuses to
            // close - snap right back to the fully open position instead.
            drawer.style.transition = `transform ${SNAP_BACK_DURATION_S}s cubic-bezier(0.16, 1, 0.3, 1)`;
            drawer.style.transform = 'translate3d(0, 0, 0)';

            // Smoothly snap floating comments mute button back to its resting position above comments section
            const commentsMuteBtn = document.getElementById('comments-mute-btn');
            if (commentsMuteBtn) {
                const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
                const expectedMobileH = isPWA ? (window.innerHeight * 0.455) : (window.innerHeight * 0.35);
                const measuredH = drawer.getBoundingClientRect().height;
                const realH = (measuredH && measuredH > 50) ? measuredH : (drawer.offsetHeight || expectedMobileH);
                
                commentsMuteBtn.style.transition = `bottom ${SNAP_BACK_DURATION_S}s cubic-bezier(0.16, 1, 0.3, 1), opacity ${SNAP_BACK_DURATION_S}s ease-out`;
                commentsMuteBtn.style.setProperty('bottom', `${realH + 12}px`, 'important');
                commentsMuteBtn.style.opacity = '1.0';
                commentsMuteBtn.style.pointerEvents = 'auto';
                setTimeout(() => {
                    if (commentsMuteBtn) commentsMuteBtn.style.removeProperty('transition');
                }, SNAP_BACK_DURATION_S * 1000 + 30);
            }

            const isPC = window.innerWidth >= 768;
            if (isPC) {
                if (container) {
                    const targetTop = Math.max(150, window.innerHeight - initialDrawerH);
                    container.style.transition = `height ${SNAP_BACK_DURATION_S}s cubic-bezier(0.16, 1, 0.3, 1)`;
                    container.style.setProperty('height', `${targetTop}px`, 'important');
                    container.style.setProperty('max-height', `${targetTop}px`, 'important');
                }
            } else if (video) {
                video.style.transition = `transform ${SNAP_BACK_DURATION_S}s cubic-bezier(0.16, 1, 0.3, 1)`;
                video.style.transformOrigin = 'center center';
                video.style.setProperty('transform', `translate3d(0, ${getOpenVideoShiftY()}, 0)`, 'important');
            }
            if (video) {
                setTimeout(() => { video.style.removeProperty('will-change'); }, SNAP_BACK_DURATION_S * 1000 + 30);
            }
        }

        dragSource = null;
        startY = 0;
        currentY = 0;
        updateContentCursor();
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('mousedown', onStart);

    if (contentList) {
        contentList.addEventListener('touchstart', onContentTouchStart, { passive: true });
        // Mouse-driven version of the same gesture, so PC users can drag the
        // comment list itself (once scrolled to the top) to close, not just
        // the notch.
        contentList.addEventListener('mousedown', onContentMouseDown);
        contentList.addEventListener('scroll', updateContentCursor, { passive: true });
        contentList.addEventListener('mouseenter', updateContentCursor);
        contentList.addEventListener('mouseleave', () => {
            if (!isDragging) contentList.style.cursor = '';
        });
    }

    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
}

// Active and Inactive SVG Icons for Navbar Buttons
const NAV_ICONS = {
    home: {
        active: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.1l9 7.2v11.7a1 1 0 01-1 1h-5v-6a1 1 0 00-1-1h-4a1 1 0 00-1 1v6H4a1 1 0 01-1-1V9.3l9-7.2z"/></svg>`,
        inactive: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 2.1l9 7.2v11.7a1 1 0 01-1 1h-5v-6a1 1 0 00-1-1h-4a1 1 0 00-1 1v6H4a1 1 0 01-1-1V9.3l9-7.2z"/></svg>`
    },
    search: {
        active: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" stroke-width="2.2"></circle><circle cx="11" cy="11" r="2.2" fill="currentColor" stroke="none"></circle><line x1="21" y1="21" x2="16.65" y2="16.65" stroke-width="2.5"></line></svg>`,
        inactive: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>`
    },
    reels: {
        active: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-2 5.5l6.5 4.5-6.5 4.5v-9z"/></svg>`,
        inactive: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><polygon points="10,8 16,12 10,16"/></svg>`
    }
};

function positionNavbarBubble(tab) {
    ['home', 'search', 'reels'].forEach(t => {
        const btn = document.getElementById(`nav-btn-${t}`);
        if (!btn) return;
        const bubble = btn.querySelector('.nav-btn-bubble');
        const iconContainer = btn.querySelector('.nav-btn-icon');
        
        if (t === tab) {
            if (iconContainer && NAV_ICONS[t]) {
                iconContainer.innerHTML = NAV_ICONS[t].active;
                iconContainer.className = 'nav-btn-icon relative z-10 text-white scale-105 transition-all duration-200';
            }
            if (bubble) {
                bubble.classList.remove('opacity-0', 'scale-75', 'animate-bubble-pop');
                void bubble.offsetWidth; // force DOM reflow to restart animation cleanly
                bubble.classList.add('animate-bubble-pop');
            }
        } else {
            if (iconContainer && NAV_ICONS[t]) {
                iconContainer.innerHTML = NAV_ICONS[t].inactive;
                iconContainer.className = 'nav-btn-icon relative z-10 text-white/50 transition-all duration-200';
            }
            if (bubble) {
                bubble.classList.remove('animate-bubble-pop');
                bubble.classList.add('opacity-0', 'scale-75');
            }
        }
    });
}

function onNavClick(target) {
    if (target === 'send' || target === 'profile') return;

    // Trigger per-icon bubble pop scaling (starts 0.75x -> 1.0x) on every click
    positionNavbarBubble(target);

    const customHeader = document.getElementById('custom-feed-header');
    if (customHeader) customHeader.classList.add('hidden');

    if (target === 'reels') {
        if (currentTab === 'reels' && activeFeedMode === 'all') return;
        activeFeedMode = 'all'; // Tapping Reels on bottom nav always returns to global feed
        renderReelsFeed();
        if (!hasResumedReelsThisSession) {
            hasResumedReelsThisSession = true;
            selectReelFromDashboard();
        } else {
            selectReelFromDashboard(currentIndex);
        }
    } else if (target === 'home') {
        if (currentTab === 'home') return;
        if (currentTab.startsWith('grid-')) {
            // On the Clips page — go to the main dashboard
            showMainDashboard();
            return;
        }
        if (activeFeedMode !== 'all') {
            // Inside a custom (bookmarked/liked/learned) reels feed —
            // go back to the collection grid
            returnToGridFromReels();
            return;
        }
        showMainDashboard();
    } else if (target === 'search') {
        if (currentTab === 'search') return;
        activeFeedMode = 'all';
        showSearchDashboard();
    }
}

function highlightStartSwipingButton() {
    const btn = document.getElementById('start-swiping-btn');
    if (btn) {
        btn.classList.add('ring-4', 'ring-teal-300', 'shadow-[0_0_30px_rgba(45,212,191,0.8)]', 'animate-pulse', 'scale-105');
    }
}

function removeStartSwipingHighlight() {
    const btn = document.getElementById('start-swiping-btn');
    if (btn) {
        btn.classList.remove('ring-4', 'ring-teal-300', 'shadow-[0_0_30px_rgba(45,212,191,0.8)]', 'animate-pulse', 'scale-105');
    }
}

// Select a reel from the dashboard and transition smoothly
function selectReelFromDashboard(index) {
    removeStartSwipingHighlight();
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const gridScreen = document.getElementById('grid-screen');
    const feed = document.getElementById('reels-feed');
    if (!mainScreen || !feed) return;
    
    userHasInteracted = true;
    isProgrammaticScroll = true;
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
    }

    pauseAllVideos();
    
    currentTab = 'reels';
    positionNavbarBubble('reels');
    const isPC = window.innerWidth >= 768;
    if (isPC) {
        hideNavbarOnPCReels();
    }
    
    const feedData = getActiveFeed();
    const targetIndex = (typeof index === 'number' && !isNaN(index) && index >= 0 && index < feedData.length)
        ? index
        : getResumeIndex(index);
    updateSavedReelIndex(targetIndex);
    hydrateWindow(targetIndex);
    
    // Temporarily set scrollBehavior to auto so positioning is instant without fast scroll animation
    const originalBehavior = feed.style.scrollBehavior;
    feed.style.scrollBehavior = 'auto';
    
    // Set scroll position BEFORE unhiding feed so card 0 (first reel) never flashes
    const expectedScrollPos = targetIndex * window.innerHeight;
    feed.scrollTop = expectedScrollPos;
    
    // Unhide feed now that scroll position is already at targetIndex
    feed.classList.remove('hidden');
    updateFocusModeBtnVisibility();
    
    // Fine-tune scroll position using offsetTop if layout differs slightly
    const targetCard = feed.children[targetIndex];
    const scrollPos = targetCard ? targetCard.offsetTop : expectedScrollPos;
    feed.scrollTop = scrollPos;
    
    // Restore smooth scroll behavior after frame paint
    requestAnimationFrame(() => {
        if (targetCard) feed.scrollTop = targetCard.offsetTop;
        setTimeout(() => {
            feed.style.scrollBehavior = originalBehavior;
        }, 60);
    });
    
    playActiveVideo(targetIndex);
    
    setTimeout(() => {
        isProgrammaticScroll = false;
    }, 250);
    
    // Instantly hide main, search, and grid screens
    mainScreen.classList.add('hidden');
    mainScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    if (searchScreen) {
        searchScreen.classList.add('hidden');
        searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }
    if (gridScreen) {
        gridScreen.classList.add('hidden');
    }
}

// Show the main dashboard and pause current playback
function showMainDashboard() {
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const gridScreen = document.getElementById('grid-screen');
    const feed = document.getElementById('reels-feed');
    const customHeader = document.getElementById('custom-feed-header');
    if (!mainScreen || !feed) return;
    
    pauseAllVideos();
    currentTab = 'home';
    positionNavbarBubble('home');
    
    const navbar = document.getElementById('bottom-navbar');
    if (navbar) navbar.classList.remove('translate-y-full');
    if (navbarHideTimer) {
        clearTimeout(navbarHideTimer);
        navbarHideTimer = null;
    }
    isMouseInNavbarZone = false;
    
    feed.classList.add('hidden');
    updateFocusModeBtnVisibility();
    closeComments();
    
    if (searchScreen) {
        searchScreen.classList.add('hidden');
        searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }
    if (gridScreen) {
        gridScreen.classList.add('hidden');
    }
    if (customHeader) {
        customHeader.classList.add('hidden');
    }
    
    // Instantly show main screen clean & ready
    mainScreen.classList.remove('hidden', 'opacity-0', 'scale-95', 'pointer-events-none');
    
    updateHomeStats();
}

// --- Collection Ordering & Grid Helpers ---

function getBookmarkedWordsOrdered() {
    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    return Object.keys(saved);
}

function getLikedWordsOrdered() {
    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    return Object.keys(likes).filter(w => likes[w]);
}

function getLearnedWordsOrdered() {
    return JSON.parse(localStorage.getItem('learned-words')) || [];
}

// Find matching word object from appData or coreDatabase
function findWordObject(wordStr) {
    const clean = String(wordStr || '').trim().toLowerCase();
    let found = appData.find(w => (w.word || '').toLowerCase() === clean);
    if (found) return found;

    if (typeof coreDatabase !== 'undefined') {
        const bookData = coreDatabase["GRE-Essential"];
        if (bookData) {
            let allWords = Array.isArray(bookData) ? bookData : [];
            if (!Array.isArray(bookData)) {
                Object.keys(bookData).forEach(setName => {
                    allWords = allWords.concat(bookData[setName]);
                });
            }
            const dbMatch = allWords.find(w => (w.word || '').trim().toLowerCase() === clean);
            if (dbMatch) {
                return {
                    ...dbMatch,
                    word: dbMatch.word.trim().toLowerCase(),
                    videoSrc: `videos/${dbMatch.word.trim().toLowerCase()}.mp4`
                };
            }
        }
    }
    return { word: clean, type: '', def: '', videoSrc: `videos/${clean}.mp4` };
}

// --- In-Memory & Persistent Thumbnail Image Snapshot Cache (IndexedDB + localStorage Fallback) ---
let thumbnailCanvasCache = {};

const THUMB_DB_NAME = 'gre_thumb_cache_db';
const THUMB_DB_VER = 1;
const THUMB_STORE_NAME = 'snapshots';
let thumbDBInstance = null;

function getThumbDB() {
    if (thumbDBInstance) return Promise.resolve(thumbDBInstance);
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(THUMB_DB_NAME, THUMB_DB_VER);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(THUMB_STORE_NAME)) {
                    db.createObjectStore(THUMB_STORE_NAME);
                }
            };
            req.onsuccess = (e) => {
                thumbDBInstance = e.target.result;
                resolve(thumbDBInstance);
            };
            req.onerror = () => resolve(null);
        } catch(err) {
            resolve(null);
        }
    });
}

function loadAllThumbnailsFromDB() {
    return getThumbDB().then(db => {
        if (!db) return;
        return new Promise(resolve => {
            try {
                const tx = db.transaction(THUMB_STORE_NAME, 'readonly');
                const store = tx.objectStore(THUMB_STORE_NAME);
                const req = store.openCursor();
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.key && cursor.value) {
                            thumbnailCanvasCache[String(cursor.key).toLowerCase()] = cursor.value;
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => resolve();
            } catch(err) { resolve(); }
        });
    });
}

// Synchronously prime from localStorage on script parse for fast initial render
try {
    const cachedObj = JSON.parse(localStorage.getItem('gre_thumb_snapshots') || '{}');
    Object.keys(cachedObj).forEach(k => {
        if (k && cachedObj[k]) thumbnailCanvasCache[k.toLowerCase()] = cachedObj[k];
    });
} catch(e) {}

// Asynchronously load all IndexedDB persistent snapshots on startup
loadAllThumbnailsFromDB();

function isCanvasFrameNonBlack(ctx, width, height) {
    try {
        const points = [
            [Math.floor(width / 2), Math.floor(height / 2)],
            [Math.floor(width / 4), Math.floor(height / 4)],
            [Math.floor(width * 3 / 4), Math.floor(height / 4)],
            [Math.floor(width / 4), Math.floor(height * 3 / 4)],
            [Math.floor(width * 3 / 4), Math.floor(height * 3 / 4)],
            [Math.floor(width / 3), Math.floor(height / 2)],
            [Math.floor(width * 2 / 3), Math.floor(height / 2)]
        ];
        let total = 0;
        for (const [px, py] of points) {
            const p = ctx.getImageData(px, py, 1, 1).data;
            total += (p[0] + p[1] + p[2]);
        }
        return (total / points.length) > 12;
    } catch(e) {
        return true;
    }
}

function saveThumbnailToStorage(word, dataUrl) {
    const cleanWord = String(word || '').trim().toLowerCase();
    if (!cleanWord || !dataUrl) return;
    thumbnailCanvasCache[cleanWord] = dataUrl;

    // Save to IndexedDB asynchronously (unlimited quota on iOS & Android PWA)
    getThumbDB().then(db => {
        if (!db) return;
        try {
            const tx = db.transaction(THUMB_STORE_NAME, 'readwrite');
            const store = tx.objectStore(THUMB_STORE_NAME);
            store.put(dataUrl, cleanWord);
        } catch(e) {}
    });

    // Also attempt localStorage write as secondary cache
    try {
        localStorage.setItem('gre_thumb_snapshots', JSON.stringify(thumbnailCanvasCache));
    } catch(e) {}

    // Immediately replace any active video tag in the grid DOM for this word
    try {
        const card = document.querySelector(`.grid-thumb-card[data-word="${cleanWord}"]`);
        if (card) {
            const videoEl = card.querySelector('video.grid-thumb-video');
            if (videoEl) {
                const img = document.createElement('img');
                img.className = 'grid-thumb-video w-full h-full object-cover pointer-events-none block';
                img.src = dataUrl;
                img.alt = cleanWord;
                videoEl.replaceWith(img);
            }
        }
    } catch(e) {}
}

function generateThumbnailFromVideoSrc(videoSrc, word) {
    return new Promise((resolve) => {
        const cleanWord = String(word || '').trim().toLowerCase();
        if (!cleanWord || !videoSrc) {
            resolve(null);
            return;
        }
        if (thumbnailCanvasCache[cleanWord]) {
            resolve(thumbnailCanvasCache[cleanWord]);
            return;
        }

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        let finished = false;
        let playAttempted = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            video.onseeked = null;
            video.onloadeddata = null;
            video.onerror = null;
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch(e) {}
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve(null);
        }, 5000);

        const tryDrawFrame = () => {
            try {
                if (video.videoWidth && video.videoHeight) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 300;
                    canvas.height = 300;
                    const ctx = canvas.getContext('2d');

                    const vw = video.videoWidth;
                    const vh = video.videoHeight;
                    const scale = Math.max(canvas.width / vw, canvas.height / vh);
                    const renderW = vw * scale;
                    const renderH = vh * scale;
                    const offsetX = (canvas.width - renderW) / 2;
                    const offsetY = (canvas.height - renderH) / 2;

                    ctx.fillStyle = '#0d0d0d';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(video, 0, 0, vw, vh, offsetX, offsetY, renderW, renderH);

                    if (isCanvasFrameNonBlack(ctx, canvas.width, canvas.height)) {
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                        if (dataUrl && dataUrl.length > 100) {
                            saveThumbnailToStorage(cleanWord, dataUrl);
                            clearTimeout(timer);
                            cleanup();
                            resolve(dataUrl);
                            return true;
                        }
                    }
                }
            } catch(e) {}
            return false;
        };

        video.onseeked = () => {
            const ok = tryDrawFrame();
            if (ok) return;
            // WebKit Blob URL Fix: Play offscreen video briefly for 60ms to force hardware decoder frame buffer to populate
            if (!playAttempted) {
                playAttempted = true;
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        setTimeout(() => {
                            try { video.pause(); } catch(e) {}
                            const retryOk = tryDrawFrame();
                            if (!retryOk) {
                                clearTimeout(timer);
                                cleanup();
                                resolve(null);
                            }
                        }, 60);
                    }).catch(() => {
                        clearTimeout(timer);
                        cleanup();
                        resolve(null);
                    });
                }
            } else {
                clearTimeout(timer);
                cleanup();
                resolve(null);
            }
        };

        video.onloadeddata = () => {
            try {
                const targetTime = (video.duration && video.duration >= 0.5) ? 0.5 : ((video.duration && video.duration > 0) ? video.duration / 2 : 0.1);
                video.currentTime = targetTime;
            } catch(e) {
                clearTimeout(timer);
                cleanup();
                resolve(null);
            }
        };

        video.onerror = () => {
            clearTimeout(timer);
            cleanup();
            resolve(null);
        };

        video.src = videoSrc;
    });
}

function prioritizeCollectionThumbnails() {
    if (!appData || appData.length === 0) return;
    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    const learned = JSON.parse(localStorage.getItem('learned-words')) || [];

    const priorityWords = new Set([
        ...Object.keys(saved),
        ...Object.keys(likes),
        ...learned
    ].map(w => String(w || '').trim().toLowerCase()).filter(Boolean));

    const priorityEntries = appData.filter(e => e && e.word && priorityWords.has(String(e.word).trim().toLowerCase()));
    if (priorityEntries.length > 0) {
        generateThumbnailsForEntries(priorityEntries);
    }
}

function generateThumbnailsForEntries(entries) {
    if (!entries || !entries.length) return;
    (async () => {
        const missing = entries.filter(e => {
            if (!e || !e.word) return false;
            const cleanWord = String(e.word || '').trim().toLowerCase();
            return !thumbnailCanvasCache[cleanWord];
        });

        if (missing.length === 0) return;

        const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
        const CONCURRENCY = isMobileDevice ? 2 : 5;

        for (let i = 0; i < missing.length; i += CONCURRENCY) {
            const chunk = missing.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(entry => {
                const cleanWord = String(entry.word || '').trim().toLowerCase();
                const vSrc = entry.videoSrc || `videos/${cleanWord}.mp4`;
                return generateThumbnailFromVideoSrc(vSrc, cleanWord);
            }));
        }
    })();
}

function captureThumbnailCanvas(videoEl, word) {
    if (!word) return;
    try {
        if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;
        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;

        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');

        // Scale and center-align full video frame with 0 gray gaps
        const scale = Math.max(canvas.width / vw, canvas.height / vh);
        const renderW = vw * scale;
        const renderH = vh * scale;
        const offsetX = (canvas.width - renderW) / 2;
        const offsetY = (canvas.height - renderH) / 2;

        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(videoEl, 0, 0, vw, vh, offsetX, offsetY, renderW, renderH);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrl && dataUrl.length > 100) {
            saveThumbnailToStorage(word, dataUrl);
            // Only replace the video DOM node when inside a grid card (not the reel feed)
            if (videoEl.closest('.grid-thumb-card')) {
                const img = document.createElement('img');
                img.className = 'grid-thumb-video w-full h-full object-cover pointer-events-none block';
                img.src = dataUrl;
                img.alt = 'Thumbnail';
                videoEl.replaceWith(img);
            }
        }
    } catch(e) {}
}

function getAvailableVideoWordsSet() {
    if (appData && appData.length > 0) {
        return new Set(appData.map(w => (w.word || '').toLowerCase()));
    }
    return new Set();
}

function showGridScreen(category) {
    if (!category) category = 'bookmarked';
    currentGridCategory = category;
    currentTab = 'grid-' + category;

    pauseAllVideos();

    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const reelsFeed = document.getElementById('reels-feed');
    const gridScreen = document.getElementById('grid-screen');
    const customHeader = document.getElementById('custom-feed-header');

    if (mainScreen) mainScreen.classList.add('hidden');
    if (searchScreen) searchScreen.classList.add('hidden');
    if (reelsFeed) reelsFeed.classList.add('hidden');
    if (customHeader) customHeader.classList.add('hidden');

    if (gridScreen) gridScreen.classList.remove('hidden');

    const navbar = document.getElementById('bottom-navbar');
    if (navbar) navbar.classList.remove('translate-y-full');

    // Update Tab Highlights with unique active colors (Saved=Turquoise, Liked=Red, Learned=Green)
    ['bookmarked', 'liked', 'learned'].forEach(cat => {
        const tabBtn = document.getElementById(`grid-tab-${cat}`);
        if (tabBtn) {
            if (cat === category) {
                let activeColorClass = 'bg-teal-400 text-black font-extrabold shadow-sm';
                if (cat === 'liked') activeColorClass = 'bg-rose-500 text-white font-extrabold shadow-sm';
                if (cat === 'learned') activeColorClass = 'bg-emerald-400 text-black font-extrabold shadow-sm';
                tabBtn.className = `px-3.5 py-1 rounded-full transition-all ${activeColorClass}`;
            } else {
                tabBtn.className = 'px-3.5 py-1 rounded-full transition-all text-white/60 hover:text-white';
            }
        }
    });

    const titleEl = document.getElementById('grid-screen-title');
    const countEl = document.getElementById('grid-screen-count');
    const emptyIcon = document.getElementById('grid-empty-icon');
    const emptyTitle = document.getElementById('grid-empty-title');
    const emptyMsg = document.getElementById('grid-empty-msg');

    let rawWordStrings = [];
    let titleText = '';
    let categoryLabel = '';
    let hoverBorderClass = 'group-hover:border-teal-400/80 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.3)]';

    if (category === 'bookmarked') {
        rawWordStrings = getBookmarkedWordsOrdered();
        titleText = 'Saved Clips';
        categoryLabel = 'Saved';
        hoverBorderClass = 'group-hover:border-teal-400/80 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.3)]';
        if (emptyTitle) emptyTitle.textContent = 'No Saved Clips Yet';
        if (emptyMsg) emptyMsg.textContent = 'Save your favorite word clips while swiping to see them here.';
        if (emptyIcon) emptyIcon.innerHTML = `<svg class="w-8 h-8 text-teal-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>`;
    } else if (category === 'liked') {
        rawWordStrings = getLikedWordsOrdered();
        titleText = 'Liked Clips';
        categoryLabel = 'Liked';
        hoverBorderClass = 'group-hover:border-rose-500/80 group-hover:shadow-[0_0_18px_rgba(244,63,94,0.3)]';
        if (emptyTitle) emptyTitle.textContent = 'No Liked Clips Yet';
        if (emptyMsg) emptyMsg.textContent = 'Like clips while swiping to build your personal collection here.';
        if (emptyIcon) emptyIcon.innerHTML = `<svg class="w-8 h-8 text-rose-400 fill-current" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    } else if (category === 'learned') {
        rawWordStrings = getLearnedWordsOrdered();
        titleText = 'Learned Clips';
        categoryLabel = 'Learned';
        hoverBorderClass = 'group-hover:border-emerald-400/80 group-hover:shadow-[0_0_18px_rgba(52,211,153,0.3)]';
        if (emptyTitle) emptyTitle.textContent = 'No Learned Clips Yet';
        if (emptyMsg) emptyMsg.textContent = 'Mark words as learned while swiping to track your progress here.';
        if (emptyIcon) emptyIcon.innerHTML = `<svg class="w-8 h-8 text-emerald-400" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"/></svg>`;
    }

    // Filter to ONLY include words that are imported in appData
    const availSet = getAvailableVideoWordsSet();
    const wordListStrings = rawWordStrings.filter(w => availSet.has((w || '').toLowerCase()));

    if (titleEl) titleEl.textContent = titleText;
    if (countEl) countEl.textContent = `${wordListStrings.length} ${categoryLabel} Word${wordListStrings.length === 1 ? '' : 's'}`;

    const gridWordObjs = wordListStrings.map(findWordObject);
    const container = document.getElementById('grid-items-container');
    const emptyState = document.getElementById('grid-empty-state');

    if (!container) return;

    if (gridWordObjs.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            const emptyBtn = emptyState.querySelector('button');
            if (appData.length === 0) {
                if (emptyTitle) emptyTitle.textContent = 'No Clips Imported Yet';
                if (emptyMsg) emptyMsg.textContent = 'Import video clips on the home screen to view your saved, liked, and learned words.';
                if (emptyBtn) {
                    emptyBtn.textContent = 'Import Clips';
                    emptyBtn.setAttribute('onclick', 'importLocalClips()');
                }
            } else {
                if (emptyBtn) {
                    emptyBtn.textContent = 'Start Swiping';
                    emptyBtn.setAttribute('onclick', "onNavClick('reels')");
                }
            }
        }
    } else {
        if (emptyState) emptyState.classList.add('hidden');
        container.innerHTML = gridWordObjs.map((w, index) => {
            const vSrc = w.videoSrc || `videos/${w.word}.mp4`;
            const wordKey = (w.word || '').toLowerCase();
            const isBookmarked = getBookmarkState(w.word);
            const isLiked = getLikeState(w.word);
            const isLearned = getLearnedState(w.word);

            let badges = '';
            if (isBookmarked) {
                badges += `<span class="p-1 rounded-full bg-black/80 border border-white/20 text-teal-300 shadow-md">
                    <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3.5 7 3.5V5c0-1.1-.9-2-2-2z"/></svg>
                </span>`;
            }
            if (isLiked) {
                badges += `<span class="p-1 rounded-full bg-black/80 border border-white/20 text-rose-500 shadow-md">
                    <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </span>`;
            }
            if (isLearned) {
                badges += `<span class="p-1 rounded-full bg-black/80 border border-white/20 text-emerald-400 shadow-md">
                    <svg class="w-3 h-3" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"/></svg>
                </span>`;
            }

            const cached = thumbnailCanvasCache[wordKey];
            const mediaMarkup = cached
                ? `<img src="${cached}" alt="${w.word}" class="grid-thumb-video w-full h-full object-cover pointer-events-none block">`
                : `<video src="${vSrc}#t=0.5" preload="metadata" muted playsinline class="grid-thumb-video w-full h-full object-cover pointer-events-none block" data-capture-word="${wordKey}" onloadeddata="captureThumbnailCanvas(this, '${wordKey}')" onseeked="captureThumbnailCanvas(this, '${wordKey}')"></video>`;

            return `
            <div data-index="${index}" data-word="${wordKey}" data-category="${category}" role="button" tabindex="0" class="grid-thumb-card group relative overflow-hidden bg-neutral-900 border border-transparent ${hoverBorderClass} transition-all duration-300 shadow-none cursor-pointer select-none">
                <!-- Video / Image Container -->
                <div class="grid-thumb-crop-box">
                    ${mediaMarkup}
                </div>

                <!-- Centered Word & Type Overlay (Middle of Card on both Mobile & PC) -->
                <div class="grid-thumb-center-overlay absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-2.5 pointer-events-none bg-black/60 backdrop-blur-[1px]">
                    <h3 class="grid-thumb-word text-white font-serif font-extrabold text-base sm:text-lg md:text-xl capitalize tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] leading-tight m-0 p-0">${w.word}</h3>
                    <span class="grid-thumb-type text-white/80 font-sans italic font-semibold text-xs sm:text-xs md:text-sm lowercase tracking-normal mt-1 m-0 p-0">${w.type || ''}</span>
                </div>

                <!-- Top Left Status Icons (Learn / Like / Saved) placed ABOVE center overlay -->
                <div class="grid-thumb-badges absolute top-2 left-2 z-30 flex items-center gap-1 pointer-events-none">
                    ${badges}
                </div>
            </div>`;
        }).join('');

        // Trigger background 0.5s thumbnail extraction for any uncached items
        gridWordObjs.forEach(w => {
            if (!w || !w.word) return;
            const wordKey = (w.word || '').toLowerCase();
            if (!thumbnailCanvasCache[wordKey]) {
                const vSrc = w.videoSrc || `videos/${w.word}.mp4`;
                generateThumbnailFromVideoSrc(vSrc, wordKey);
            }
        });
    }

    // Restore scroll height for this grid category
    requestAnimationFrame(() => {
        const scrollArea = document.getElementById('grid-scroll-area');
        if (scrollArea && gridScrollPositions[category] !== undefined) {
            scrollArea.scrollTop = gridScrollPositions[category];
        }
    });

    updateHomeStats();
}

function openCustomReelsFeed(category, startIdx, word) {
    // Reset all pause states so the first clip always starts playing
    reelPauseStates = {};
    reelSavedTimes = {};

    // Record current grid scroll position before launching feed
    const scrollArea = document.getElementById('grid-scroll-area');
    if (scrollArea && category) {
        gridScrollPositions[category] = scrollArea.scrollTop;
    }

    let rawWordStrings = [];
    if (category === 'bookmarked') {
        rawWordStrings = getBookmarkedWordsOrdered();
    } else if (category === 'liked') {
        rawWordStrings = getLikedWordsOrdered();
    } else if (category === 'learned') {
        rawWordStrings = getLearnedWordsOrdered();
    }

    // Filter to ONLY include words that are imported in appData
    const availSet = getAvailableVideoWordsSet();
    const wordStrings = rawWordStrings.filter(w => availSet.has((w || '').toLowerCase()));

    const items = wordStrings.map(findWordObject);
    if (items.length === 0) {
        showToast('No clips available in this collection.', 'info');
        return;
    }

    activeFeedMode = category;
    customFeedData = items;

    // Resolve target index: prefer exact positional match first, fall back to word lookup
    let targetIdx = 0;
    if (typeof startIdx === 'number' && !isNaN(startIdx) && startIdx >= 0 && startIdx < items.length) {
        if (word && (items[startIdx]?.word || '').toLowerCase() === String(word).toLowerCase()) {
            targetIdx = startIdx;
        } else if (word) {
            const found = items.findIndex(item => (item.word || '').toLowerCase() === String(word).toLowerCase());
            targetIdx = found !== -1 ? found : startIdx;
        } else {
            targetIdx = startIdx;
        }
    } else if (word) {
        const found = items.findIndex(item => (item.word || '').toLowerCase() === String(word).toLowerCase());
        if (found !== -1) targetIdx = found;
    }

    // Explicitly unhide reels feed screen and hide grid screen
    const gridScreen = document.getElementById('grid-screen');
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const reelsFeed = document.getElementById('reels-feed');

    if (gridScreen) gridScreen.classList.add('hidden');
    if (mainScreen) mainScreen.classList.add('hidden');
    if (searchScreen) searchScreen.classList.add('hidden');
    if (reelsFeed) reelsFeed.classList.remove('hidden');

    // Update floating back button color & vertical position matching IMDB badge height
    const headerBtn = document.getElementById('custom-feed-back-btn');
    const headerEl = document.getElementById('custom-feed-header');

    if (headerBtn) {
        if (category === 'bookmarked') {
            headerBtn.className = 'p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-teal-500/40 hover:border-teal-400 active:scale-95 transition-all text-teal-300 flex items-center justify-center shadow-2xl';
        } else if (category === 'liked') {
            headerBtn.className = 'p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-rose-500/40 hover:border-rose-400 active:scale-95 transition-all text-rose-400 flex items-center justify-center shadow-2xl';
        } else if (category === 'learned') {
            headerBtn.className = 'p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-emerald-500/40 hover:border-emerald-400 active:scale-95 transition-all text-emerald-400 flex items-center justify-center shadow-2xl';
        }
    }

    if (headerEl) {
        const isPC = window.innerWidth >= 768;
        const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
        headerEl.style.top = isPC ? '15px' : (isPWA ? 'max(calc(env(safe-area-inset-top, 0px) + 39px), 93px)' : 'calc(env(safe-area-inset-top, 16px) + 39px)');
        headerEl.classList.remove('hidden');
    }

    renderReelsFeed(targetIdx);
    selectReelFromDashboard(targetIdx);
}

function returnToGridFromReels() {

    pauseAllVideos();
    const headerEl = document.getElementById('custom-feed-header');
    if (headerEl) headerEl.classList.add('hidden');

    // Restore bottom navbar selection cleanly to Home tab
    currentTab = 'home';
    positionNavbarBubble('home');
    const navbar = document.getElementById('bottom-navbar');
    if (navbar) navbar.classList.remove('translate-y-full');

    showGridScreen(currentGridCategory || 'bookmarked');
}

// Populate the Words / Bookmarked / Learned / Liked stats on the home screen
function updateHomeStats() {
    const totalWords = appData.length;
    const availSet = getAvailableVideoWordsSet();
    const learnedWords = getLearnedWordsOrdered().filter(w => availSet.has((w || '').toLowerCase())).length;
    const likedCount = getLikedWordsOrdered().filter(w => availSet.has((w || '').toLowerCase())).length;
    const savedCount = getBookmarkedWordsOrdered().filter(w => availSet.has((w || '').toLowerCase())).length;

    const homeStatWords = document.getElementById('home-stat-words');
    const homeStatBookmarked = document.getElementById('home-stat-bookmarked');
    const homeStatLearned = document.getElementById('home-stat-learned');
    const homeStatLiked = document.getElementById('home-stat-liked');

    if (homeStatWords && homeStatWords.querySelector('span')) homeStatWords.querySelector('span').textContent = totalWords > 0 ? totalWords : '0';
    if (homeStatBookmarked && homeStatBookmarked.querySelector('span')) homeStatBookmarked.querySelector('span').textContent = savedCount;
    if (homeStatLearned && homeStatLearned.querySelector('span')) homeStatLearned.querySelector('span').textContent = learnedWords;
    if (homeStatLiked && homeStatLiked.querySelector('span')) homeStatLiked.querySelector('span').textContent = likedCount;
}

// Show the empty search dashboard screen
function showSearchDashboard() {
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const feed = document.getElementById('reels-feed');
    if (!searchScreen || !feed) return;
    
    pauseAllVideos();
    currentTab = 'search';
    positionNavbarBubble('search');
    
    const navbar = document.getElementById('bottom-navbar');
    if (navbar) navbar.classList.remove('translate-y-full');
    if (navbarHideTimer) {
        clearTimeout(navbarHideTimer);
        navbarHideTimer = null;
    }
    isMouseInNavbarZone = false;
    
    feed.classList.add('hidden');
    updateFocusModeBtnVisibility();
    closeComments();
    
    if (mainScreen) {
        mainScreen.classList.add('hidden');
        mainScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }
    
    // Instantly show search screen clean & ready
    searchScreen.classList.remove('hidden', 'opacity-0', 'scale-95', 'pointer-events-none');
    
    // Focus search input
    const searchInput = document.getElementById('home-search-input');
    if (searchInput) {
        searchInput.value = '';
        document.getElementById('search-results-list').innerHTML = '';
        setTimeout(() => searchInput.focus(), 150);
        searchInput.oninput = () => filterSearchWords(searchInput.value.trim().toLowerCase());
    }
}

// Filter words on search screen
function filterSearchWords(query) {
    const resultsList = document.getElementById('search-results-list');
    if (!resultsList) return;
    if (!query) { resultsList.innerHTML = ''; return; }

    if (appData.length === 0) {
        resultsList.innerHTML = '<p class="text-white/40 text-center py-4 text-xs">No imported clips available. Import video clips on the home screen to search.</p>';
        return;
    }

    const matches = appData.filter(w => w.word.includes(query)).slice(0, 20);
    if (matches.length === 0) {
        resultsList.innerHTML = '<p class="text-white/30 text-center py-4 text-xs">No matches found.</p>';
        return;
    }

    resultsList.innerHTML = matches.map((w, i) => {
        const reelIdx = appData.indexOf(w);
        const movieName = w.show || w.source || "GRE-Essential";
        return `<div onclick="selectReelFromDashboard(${reelIdx})" class="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 cursor-pointer transition border border-white/10 mb-2 min-w-0">
            <div class="flex items-baseline gap-2 min-w-0 shrink">
                <span class="text-white font-bold text-sm tracking-wide capitalize truncate">${w.word}</span>
                <span class="text-teal-400/80 text-xs italic font-serif shrink-0">${w.type}</span>
            </div>
            <div class="flex items-center gap-1 text-white/40 text-[11px] font-medium shrink-0 max-w-full truncate">
                <svg class="w-3 h-3 text-white/30 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span class="truncate">${formatShowName(movieName)}</span>
            </div>
        </div>`;
    }).join('');
}

// Random word picker from search screen
function pickRandomWord() {
    if (appData.length === 0) {
        showToast('No imported clips available yet. Import video clips first!', 'info');
        return;
    }
    const idx = Math.floor(Math.random() * appData.length);
    selectReelFromDashboard(idx);
}

// Import Clips - lets the user pick video files from their device, matches
// each filename against the word database, and drops matched clips straight
// into the swipeable feed as full reel cards. Word, type, definition, movie
// name, and comments all populate exactly like any other card since the
// matched database entry is used as-is - only the video source differs.
function importLocalClips() {
    // Bring bottom navbar back if hidden on PC
    document.body.classList.remove('navbar-hidden');
    const navbar = document.getElementById('bottom-navbar');
    if (navbar) navbar.classList.remove('translate-y-full');

    const input = document.getElementById('import-clips-input');
    if (!input) return;
    input.value = '';
    input.click();
}

// Look up a database word entry whose word matches a given filename (handles mobile paths, URL encoding & suffixes)
function findWordEntryByFilename(fileName) {
    if (typeof coreDatabase === 'undefined') return null;
    const bookData = coreDatabase['GRE-Essential'];
    if (!bookData) return null;

    const allWords = Array.isArray(bookData)
        ? bookData
        : Object.keys(bookData).reduce((acc, key) => acc.concat(bookData[key]), []);

    if (!fileName) return null;

    // 1. Decode URI component in case mobile browser URL-encodes filename
    let raw = String(fileName);
    try {
        raw = decodeURIComponent(raw);
    } catch(e) {}

    // 2. Extract ONLY basename (strip path prefixes like C:\fakepath\ or Download/)
    let base = raw.split(/[/\\]/).pop().trim().toLowerCase();

    // 3. Remove non-breaking / zero-width spaces
    base = base.replace(/[\u00a0\u200b\u200c\u200d]/g, ' ');

    // 4. Strip ALL video file extensions (.mp4, .mov, .webm, .mkv, .avi, etc.)
    while (/\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|mp3|wav|aac|ogg|qt)$/i.test(base)) {
        base = base.replace(/\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|mp3|wav|aac|ogg|qt)$/i, '');
    }
    base = base.replace(/\.[a-zA-Z0-9]+$/i, '').trim();

    // 5. Clean common mobile copy suffixes (e.g. abate(1), abate_1, abate-1, abate copy, abate trim)
    const cleanedBase = base
        .replace(/[\(\s\_\-]+\d+[\)\s\_\-]*$/i, '')
        .replace(/[\(\s\_\-]+(copy|trim|final|clip)[\)\s\_\-]*$/i, '')
        .trim();

    const norm = cleanedBase.replace(/[^a-z0-9]/gi, '');
    const rawNorm = base.replace(/[^a-z0-9]/gi, '');

    // 6. Multi-tier matching
    // Priority 1: Exact word match
    let match = allWords.find(w => {
        const wWord = (w.word || '').trim().toLowerCase();
        return wWord === cleanedBase || wWord === base;
    });
    if (match) return match;

    // Priority 2: Normalized alphanumeric match
    match = allWords.find(w => {
        const wNorm = (w.word || '').trim().toLowerCase().replace(/[^a-z0-9]/gi, '');
        return wNorm === norm || wNorm === rawNorm;
    });
    if (match) return match;

    // Priority 3: Substring token match (e.g. "abate_720p" -> matches "abate")
    match = allWords.find(w => {
        const wWord = (w.word || '').trim().toLowerCase();
        const wNorm = wWord.replace(/[^a-z0-9]/gi, '');
        if (!wNorm) return false;
        return norm.includes(wNorm) || wNorm.includes(norm);
    });

    return match || null;
}

function showImportLoading(show) {
    const overlay = document.getElementById('import-loading-overlay');
    if (!overlay) return;
    if (show) {
        overlay.classList.remove('hidden');
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
        });
    } else {
        overlay.classList.add('opacity-0');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 320);
    }
}

function setImportProgress(percent) {
    const bar = document.getElementById('import-loading-bar');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

function handleLocalClipsSelected(fileList) {
    const input = document.getElementById('import-clips-input');
    const rawFiles = Array.from(fileList || []);

    const files = rawFiles.filter(f => {
        if (!f) return false;
        const name = String(f.name || '').toLowerCase();
        const type = String(f.type || '').toLowerCase();
        return (
            type.startsWith('video/') ||
            /\.(mp4|mov|m4v|webm|mkv|avi|3gp|flv|qt)$/i.test(name) ||
            (f.size && f.size > 0)
        );
    });

    if (files.length === 0) {
        if (input) input.value = '';
        return;
    }

    const isPC = window.innerWidth >= 768;

    if (isPC) {
        // ON PC ONLY: 0ms instant import & playback start!
        const existingWords = new Set(appData.map(w => (w.word || '').toLowerCase()));
        const addedBatchWords = new Set();
        const newEntries = [];
        const unmatched = [];
        const duplicates = [];

        files.forEach(file => {
            const match = findWordEntryByFilename(file.name);
            if (!match) {
                let cleanName = String(file.name).split(/[/\\]/).pop().trim();
                cleanName = cleanName.replace(/\.[a-zA-Z0-9]+$/gi, '').trim();
                unmatched.push(cleanName);
                return;
            }

            const wordLower = (match.word || '').toLowerCase();
            if (existingWords.has(wordLower) || addedBatchWords.has(wordLower)) {
                duplicates.push(match.word);
                return;
            }

            addedBatchWords.add(wordLower);
            existingWords.add(wordLower);
            newEntries.push({
                ...match,
                videoSrc: URL.createObjectURL(file)
            });
        });

        if (input) input.value = '';

        if (unmatched.length > 0) {
            showToast(`No matching word found for: ${unmatched.join(', ')}`, 'error');
        }

        if (newEntries.length === 0) {
            if (duplicates.length > 0) {
                showToast(`Already imported: ${duplicates.join(', ')}`, 'info');
            }
            return;
        }

        const wasEmpty = appData.length === 0;
        const insertAt = appData.length > 0 ? Math.min(currentIndex + 1, appData.length) : 0;
        appData.splice(insertAt, 0, ...newEntries);
        generateThumbnailsForEntries(newEntries);

        const targetReelIndex = wasEmpty ? getResumeIndex() : insertAt;
        reelPauseStates[targetReelIndex] = false;
        userHasInteracted = true;
        currentIndex = targetReelIndex;
        updateSavedReelIndex(targetReelIndex);
        pauseAllVideos();

        renderReelsFeed();

        let msg = `${newEntries.length} new clip${newEntries.length === 1 ? '' : 's'} added`;
        if (duplicates.length > 0) {
            msg += ` (skipped duplicate${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')})`;
        }
        showToast(msg, 'success');

        currentTab = '';
        selectReelFromDashboard(targetReelIndex);
        return;
    }

    showImportLoading(true);
    setImportProgress(20);

    setTimeout(() => {
        const existingWords = new Set(appData.map(w => (w.word || '').toLowerCase()));
        const addedBatchWords = new Set();

        const newEntries = [];
        const unmatched = [];
        const duplicates = [];

        files.forEach(file => {
            const match = findWordEntryByFilename(file.name);
            if (!match) {
                let cleanName = String(file.name).split(/[/\\]/).pop().trim();
                cleanName = cleanName.replace(/\.[a-zA-Z0-9]+$/gi, '').trim();
                unmatched.push(cleanName);
                return;
            }

            const wordLower = (match.word || '').toLowerCase();
            if (existingWords.has(wordLower) || addedBatchWords.has(wordLower)) {
                duplicates.push(match.word);
                return;
            }

            addedBatchWords.add(wordLower);
            existingWords.add(wordLower);
            newEntries.push({
                ...match,
                videoSrc: URL.createObjectURL(file)
            });
        });

        if (input) input.value = '';

        if (unmatched.length > 0) {
            showToast(`No matching word found for: ${unmatched.join(', ')}`, 'error');
        }

        if (newEntries.length === 0) {
            showImportLoading(false);
            if (duplicates.length > 0) {
                showToast(`Already imported: ${duplicates.join(', ')}`, 'info');
            }
            return;
        }

        const wasEmpty = appData.length === 0;
        const insertAt = appData.length > 0 ? Math.min(currentIndex + 1, appData.length) : 0;
        appData.splice(insertAt, 0, ...newEntries);
        generateThumbnailsForEntries(newEntries);

        const targetReelIndex = wasEmpty ? getResumeIndex() : insertAt;
        reelPauseStates[targetReelIndex] = false;
        userHasInteracted = true;
        currentIndex = targetReelIndex;
        updateSavedReelIndex(targetReelIndex);
        pauseAllVideos();

        // Hide reels feed before DOM construction so card 0 is NEVER painted to screen
        const feed = document.getElementById('reels-feed');
        if (feed) feed.classList.add('hidden');

        renderReelsFeed();
        setImportProgress(60);

        const targetCard = getCardEl(targetReelIndex);
        const video = targetCard ? attachVideoToCard(targetReelIndex) : null;
        if (video) {
            const w = appData[targetReelIndex];
            const videoSrc = video.getAttribute('data-src') || (w ? (w.videoSrc || `videos/${w.word}.mp4`) : '');
            if (videoSrc) video.src = videoSrc;
            loadedVideoWindow.add(targetReelIndex);
        }

        let isCompleted = false;
        const completeImportAndShow = () => {
            if (isCompleted) return;
            isCompleted = true;
            setImportProgress(100);

            setTimeout(() => {
                showImportLoading(false);
                let msg = `${newEntries.length} new clip${newEntries.length === 1 ? '' : 's'} added`;
                if (duplicates.length > 0) {
                    msg += ` (skipped duplicate${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')})`;
                }
                showToast(msg, 'success');

                showMainDashboard();
                highlightStartSwipingButton();
            }, 300);
        };

        if (video) {
            video.preload = 'auto';
            video.load();

            if (video.readyState >= 3) {
                setImportProgress(85);
                setTimeout(completeImportAndShow, 400);
            } else {
                setImportProgress(75);
                video.addEventListener('canplay', completeImportAndShow, { once: true });
                video.addEventListener('loadeddata', completeImportAndShow, { once: true });
                setTimeout(completeImportAndShow, 1400);
            }
        } else {
            completeImportAndShow();
        }
    }, 150);
}

function bindImportInputEvents() {
    const input = document.getElementById('import-clips-input');
    if (input) {
        input.onchange = (e) => {
            if (e.target && e.target.files && e.target.files.length > 0) {
                handleLocalClipsSelected(e.target.files);
            }
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('import-clips-btn');
    bindImportInputEvents();

    // Touch devices don't have :hover, so mirror the glow briefly on tap.
    if (btn) {
        btn.addEventListener('touchstart', () => {
            btn.classList.add('tapped');
        }, { passive: true });
        btn.addEventListener('touchend', () => {
            setTimeout(() => btn.classList.remove('tapped'), 200);
        }, { passive: true });
    }

        // Delegated click handler for the thumbnail grid. Reads data-word and
        // data-category from the card so the correct collection feed opens even
        // when video elements (which can swallow inline onclick on mobile) are
        // used as thumbnails.
        const gridContainer = document.getElementById('grid-items-container');
        if (gridContainer) {
            let pointerStartCard = null;
            let pointerStartX = 0, pointerStartY = 0;
            let handledByPointer = false;

            // Pointer-down handler: captures the card and start position so we
            // can distinguish taps from scrolls in pointerup. Uses pointer
            // events which respect pointer-events: none on child elements,
            // unlike touchstart which can target <video> elements on mobile.
            gridContainer.addEventListener('pointerdown', (e) => {
                pointerStartCard = e.target.closest('.grid-thumb-card');
                if (pointerStartCard) {
                    pointerStartX = e.clientX;
                    pointerStartY = e.clientY;
                }
            }, { passive: true });

            // Pointer-up handler: navigates to the reels feed on tap
            // (movement < 10px). Uses preventDefault to suppress the
            // subsequent click and sets the handledByPointer flag so the
            // click handler doesn't also fire.
            gridContainer.addEventListener('pointerup', (e) => {
                if (!pointerStartCard) return;
                const dx = e.clientX - pointerStartX;
                const dy = e.clientY - pointerStartY;
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    pointerStartCard = null;
                    return;
                }
                const card = pointerStartCard;
                pointerStartCard = null;
                const indexStr = card.dataset.index;
                const cardIdx = (indexStr !== undefined && indexStr !== null && indexStr !== '') ? parseInt(indexStr, 10) : null;
                const word = card.dataset.word;
                const category = card.dataset.category;
                if (category) {
                    handledByPointer = true;
                    e.preventDefault();
                    openCustomReelsFeed(category, cardIdx, word);
                    setTimeout(() => { handledByPointer = false; }, 300);
                }
            }, { passive: false });

            // Click handler as fallback for browsers without pointer events.
            gridContainer.addEventListener('click', (e) => {
                const card = e.target.closest('.grid-thumb-card');
                if (!card) return;
                if (handledByPointer) {
                    handledByPointer = false;
                    return;
                }
                const indexStr = card.dataset.index;
                const cardIdx = (indexStr !== undefined && indexStr !== null && indexStr !== '') ? parseInt(indexStr, 10) : null;
                const word = card.dataset.word;
                const category = card.dataset.category;
                if (category) {
                    openCustomReelsFeed(category, cardIdx, word);
                }
            });
        }
});

// Helper to pause all video elements
function pauseAllVideos() {
    // Kill the self-healing watchdog so it can't restart playback after we pause
    if (playWatchdogTimer) {
        clearTimeout(playWatchdogTimer);
        playWatchdogTimer = null;
    }
    // Pause every video still tracked in the map — covers the loaded window,
    // the current index, and any orphans that slipped through.
    cardVideoMap.forEach((v) => {
        if (v && !v.paused) v.pause();
    });
    [...loadedVideoWindow, currentIndex].forEach(idx => {
        updatePlayIconVisibility(idx);
    });
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initApp);
window.addEventListener('resize', () => {
    const feed = document.getElementById('reels-feed');
    if (feed && !feed.classList.contains('hidden')) {
        feed.scrollTop = currentIndex * window.innerHeight;
    }
    updateDefinitionMaxWidths();
    positionNavbarBubble(currentTab);
});
