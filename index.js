// STANDALONE DOOMSCROLL PWA LOGIC

let appData = [];
let currentIndex = 0;
let commentsOpen = false;
let commentsDragActive = false;
let doomscrollTempLikes = {};
let reelPauseStates = {};
let userHasInteracted = false;
let currentTab = 'home';
let navbarHideTimer = null;
let isMouseInNavbarZone = false;

// Priority list to place at the very top
const PRIORITY_WORDS = ["calumny", "perfidious", "renege", "moribund"];

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



// Initialize Database on load
function initApp() {
    try {
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

        // Group into priority vs normal
        const priorityWords = [];
        const normalWords = [];
        wordsWithVideo.forEach(w => {
            if (PRIORITY_WORDS.includes(w.word)) {
                priorityWords.push(w);
            } else {
                normalWords.push(w);
            }
        });

        // Sort priority words in the requested order
        priorityWords.sort((a, b) => {
            return PRIORITY_WORDS.indexOf(a.word) - PRIORITY_WORDS.indexOf(b.word);
        });

        // Sort normal words in the order of VIDEO_WORDS_SET
        const videoWordsOrder = typeof VIDEO_WORDS_SET !== 'undefined' ? Array.from(VIDEO_WORDS_SET) : [];
        normalWords.sort((a, b) => {
            const idxA = videoWordsOrder.indexOf(a.word);
            const idxB = videoWordsOrder.indexOf(b.word);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.word.localeCompare(b.word);
        });

        appData = []; // Start empty - only imported clips are active
        currentTab = 'home';

        renderReelsFeed();
        makeDrawerDraggable();

        // Register scroll listener after pre-positioning
        setupScrollListener();
        initPCNavbarHoverListeners();

        // Initialize sliding active tab bubble position on load (instantly)
        requestAnimationFrame(() => {
            positionNavbarBubble(currentTab);
        });

        // Disable pinch and gesture zoom on iOS Safari and mobile browsers
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('gesturechange', (e) => e.preventDefault());
        document.addEventListener('gestureend', (e) => e.preventDefault());

        // Disable native double-tap-to-zoom. Some WebKit versions still trigger this on a fast
        // double tap even with touch-action set, which visually shifts the whole page (including
        // the fixed bottom navbar) up until the user pinches back out.
        document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

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

    } catch (e) {
        console.error("Error during app initialization:", e);
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
function renderReelsFeed() {
    const feed = document.getElementById('reels-feed');
    feed.innerHTML = '';

    if (appData.length === 0) {
        feed.style.overflowY = 'hidden';
        feed.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full p-6 text-center select-none">
                <div class="w-16 h-16 mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-teal-400">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
                <h2 class="text-xl font-serif font-bold text-white mb-2">No Clips Imported Yet</h2>
                <p class="text-xs text-white/50 mb-6 max-w-xs leading-relaxed">Import your local GRE video clips to start studying vocabulary reels.</p>
                <button onclick="importLocalClips()" class="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-full text-xs font-semibold transition">
                    Import Clips
                </button>
            </div>
        `;
        return;
    }

    feed.style.overflowY = 'scroll';

    appData.forEach((w, idx) => {
        const card = document.createElement('div');
        card.className = 'reel-card';
        card.dataset.index = idx;
        card.dataset.word = w.word;

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
            <!-- Video & Audio Fallback Container -->
            <div class="reel-video-container w-full h-full relative flex items-center justify-center bg-gradient-to-b from-neutral-950 via-neutral-900 to-black overflow-hidden" onpointerdown="onCardDown(event, ${idx})" onpointerup="onCardUp(event, ${idx})">
                <video class="reel-video" src="${videoSrc}" preload="auto" loop playsinline webkit-playsinline muted onerror="this.classList.add('hidden'); const fb = this.parentElement.querySelector('.audio-fallback'); if (fb) fb.classList.remove('hidden');"></video>
                
                <!-- Audio/Speech Fallback Card (shown if video fails to load or errors out) -->
                <div class="audio-fallback hidden absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-neutral-950 via-teal-950/90 to-neutral-950 p-6 text-center z-10 pointer-events-auto">
                    <div class="w-20 h-20 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center mb-4 shadow-lg">
                        <svg class="w-10 h-10 text-teal-400 fill-current" viewBox="0 0 24 24">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                        </svg>
                    </div>
                    <h2 class="text-3xl md:text-4xl font-serif font-black text-white capitalize mb-1 tracking-wide">${w.word}</h2>
                    <span class="text-xs md:text-sm italic text-teal-300 mb-3">${w.type}</span>
                    <p class="text-sm md:text-base text-white/80 max-w-md leading-relaxed mb-4">${w.def}</p>
                    <button onclick="speakActiveWord(${idx})" class="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-semibold text-xs rounded-full shadow-lg transition flex items-center gap-2">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Listen Pronunciation
                    </button>
                </div>

                <!-- Big Double-Tap Heart overlay -->
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-200 play-pause-overlay">
                    <div class="p-4 bg-black/40 rounded-full text-white">
                        <svg class="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
                        </svg>
                    </div>
                </div>
            </div>

            <!-- Top Center Movie/Show Badge (hides when comments active; original on PWA, 14px on PC, 34px on Safari browser) -->
            <div class="show-badge-container absolute left-1/2 -translate-x-1/2 z-30 transition-all duration-200 pointer-events-auto max-w-[85vw]" style="top: ${window.innerWidth >= 768 ? '14px' : (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches ? 'calc(env(safe-area-inset-top, 16px) + 8px)' : 'calc(env(safe-area-inset-top, 16px) + 34px)')};">
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

                <!-- Sound / Mute Toggle Button (25% bigger on mobile: 27.5px, 20% smaller on PC: 22px) -->
                <button onclick="toggleAudioMute(event, ${idx})" class="action-btn" id="mute-btn-${idx}">
                    ${getMuteIconSvg(isAppMuted)}
                </button>
            </div>
        `;

        const video = card.querySelector('.reel-video');
        const fallback = card.querySelector('.audio-fallback');
        if (w.videoSrc && video.src !== w.videoSrc) {
            video.src = w.videoSrc;
        }

        video.addEventListener('canplay', () => {
            if (idx === currentIndex && video.paused) {
                playActiveVideo(idx);
            }
        });

        video.addEventListener('loadedmetadata', () => {
            updateDefinitionMaxWidths();
        });

        feed.appendChild(card);
    });

    requestAnimationFrame(updateDefinitionMaxWidths);
}

// Calculate dynamic max-width for definition text on PC to strictly prevent text from touching or overlapping the video
function updateDefinitionMaxWidths() {
    const isPC = window.innerWidth >= 768;
    const cards = document.querySelectorAll('.reel-card');
    
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

function getMuteIconSvg(isMuted) {
    return isMuted 
        ? `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4"/>
           </svg>`
        : `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
           </svg>`;
}

function updateMuteButtonIcons() {
    const cards = document.querySelectorAll('.reel-card');
    cards.forEach((card, idx) => {
        const btn = card.querySelector(`#mute-btn-${idx}`);
        if (btn) {
            btn.innerHTML = getMuteIconSvg(isAppMuted);
        }
    });
}

function toggleAudioMute(e, index) {
    if (e) e.stopPropagation();
    userHasInteracted = true;
    const cards = document.querySelectorAll('.reel-card');
    const card = cards[index];
    if (!card) return;
    const video = card.querySelector('.reel-video');
    if (!video) return;

    if (video.muted) {
        video.muted = false;
        isAppMuted = false;
        showToast('Sound On 🔊', 'info');
    } else {
        video.muted = true;
        isAppMuted = true;
        showToast('Sound Muted 🔇', 'info');
    }
    updateMuteButtonIcons();
}

// Synchronous mobile audio unlocker on touch/click gestures
function unlockMobileAudio() {
    userHasInteracted = true;
    if (isAppMuted) return;
    const cards = document.querySelectorAll('.reel-card');
    if (cards[currentIndex]) {
        const v = cards[currentIndex].querySelector('.reel-video');
        if (v && v.muted) {
            v.muted = false;
        }
    }
}

['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click'].forEach(evtName => {
    window.addEventListener(evtName, unlockMobileAudio, { capture: true, passive: true });
});

// Play active video card, pause all others, and pre-buffer nearby cards for 0ms scroll delay
function playActiveVideo(index) {
    updateDefinitionMaxWidths();
    const cards = document.querySelectorAll('.reel-card');
    cards.forEach((card, idx) => {
        const video = card.querySelector('.reel-video');
        const fallback = card.querySelector('.audio-fallback');

        if (idx === index) {
            if (video && !video.classList.contains('hidden')) {
                video.preload = 'auto';
                video.volume = 1.0;
                
                // Synchronously set muted state before play so audio and video stay in 0ms lockstep
                video.muted = isAppMuted ? true : false;

                if (video.paused) {
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(e => {
                            console.log("Unmuted play failed, retrying muted: ", e);
                            video.muted = true;
                            video.play().catch(() => {
                                video.classList.add('hidden');
                                if (fallback) fallback.classList.remove('hidden');
                                speakActiveWord(idx);
                            });
                        });
                    }
                }
            } else {
                if (fallback) fallback.classList.remove('hidden');
                if (userHasInteracted) {
                    speakActiveWord(idx);
                }
            }
        } else {
            if (video) {
                if (!video.paused) {
                    video.pause();
                }
                if (Math.abs(idx - index) <= 2) {
                    if (video.preload !== 'auto') {
                        video.preload = 'auto';
                    }
                } else {
                    if (video.preload !== 'none') {
                        video.preload = 'none';
                    }
                }
            }
        }
    });
    localStorage.setItem('gre_reels_index', index);
}

// Click to play/pause functionality
let lastTap = 0;
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

function onCardDown(e, index) {
    cardDragStartY = e.clientY;
    if (e.target.closest('#comments-drawer') || e.target.closest('#comments-drag-handle') || isPointerOverCommentsDrawer(e)) {
        commentsDragActive = true;
        return;
    }
    commentsDragActive = false;
    if (commentsOpen || isImdbPopupActive || suppressNextTap || Date.now() - lastCommentsOpenTime < 400 || Date.now() - lastImdbPopupTime < 2500) return;
    if (e.target.closest('button') || e.target.closest('.action-btn') || e.target.closest('.word-info-overlay') || e.target.closest('.show-badge-container') || e.target.closest('#bottom-navbar') || e.target.closest('.action-tray') || isNearActionTray(e)) return;
}

function onCardUp(e, index) {
    if (commentsOpen) {
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

    if (isImdbPopupActive || suppressNextTap || Date.now() - lastCommentsOpenTime < 400 || Date.now() - lastImdbPopupTime < 2500) {
        suppressNextTap = false;
        return;
    }
    if (e.target.closest('button') || e.target.closest('.action-btn') || e.target.closest('.word-info-overlay') || e.target.closest('.show-badge-container') || e.target.closest('#bottom-navbar') || e.target.closest('#comments-drawer') || e.target.closest('.action-tray') || isPointerOverCommentsDrawer(e) || isNearActionTray(e)) return;

    const drawer = document.getElementById('comments-drawer');
    if (drawer && !drawer.classList.contains('translate-y-full')) {
        closeComments();
        return;
    }

    const deltaY = cardDragStartY - e.clientY;
    const isPC = window.innerWidth >= 768;

    // Scroll / Swipe Guard: If finger moved > 10px vertically, treat as SCROLL/SWIPE, NOT tap!
    if (Math.abs(deltaY) > 10) {
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
    if (now - lastTap < 300) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        handleDoubleTapLike(e, index);
    } else {
        if (tapTimeout) clearTimeout(tapTimeout);
        tapTimeout = setTimeout(() => {
            const card = document.querySelectorAll('.reel-card')[index];
            if (!card) return;
            const video = card.querySelector('.reel-video');
            if (video && !video.classList.contains('hidden')) {
                if (video.paused) {
                    video.play().catch(() => {});
                    showPlayPauseOverlay(index, true);
                } else {
                    video.pause();
                    showPlayPauseOverlay(index, false);
                }
            }
            tapTimeout = null;
        }, 180);
    }
    lastTap = now;
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
    const card = document.querySelectorAll('.reel-card')[currentIndex];
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
            // If user taps Cancel (or closes modal), explicitly resume video playback!
            if (!userAccepted && wasPlayingBeforeModal && video) {
                video.play().catch(() => {});
            }

            setTimeout(() => { suppressNextTap = false; }, 2500);
        }
    }, 50);
}

// Fast single-tap play/pause splash feedback
function showPlayPauseOverlay(index, isPlay) {
    const card = document.querySelectorAll('.reel-card')[index];
    const overlay = card ? card.querySelector('.play-pause-overlay') : null;
    if (!overlay) return;

    overlay.innerHTML = isPlay 
        ? `<div class="p-4 bg-black/40 rounded-full text-white"><svg class="w-10 h-10" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg></div>`
        : `<div class="p-4 bg-black/40 rounded-full text-white"><svg class="w-10 h-10" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg></div>`;
        
    overlay.style.transition = 'opacity 0.15s ease-out';
    overlay.style.opacity = '1';
    setTimeout(() => {
        overlay.style.opacity = '0';
    }, 200);
}

// Double tap Heart Pop & Fly Animation (GPU accelerated, ultra fast & smooth)
function handleDoubleTapLike(e, index) {
    const card = document.querySelectorAll('.reel-card')[index];
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

// Speech Synthesis for Audio Fallback Mode
let synthVoice = null;
function speakActiveWord(index) {
    if (!userHasInteracted) return;
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const wObj = appData[index];
    if (!wObj) return;

    // Use a premium-sounding voice if available
    if (!synthVoice) {
        const voices = window.speechSynthesis.getVoices();
        synthVoice = voices.find(v => v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Premium")) || voices[0];
    }

    const utterWord = new SpeechSynthesisUtterance(wObj.word);
    utterWord.voice = synthVoice;
    utterWord.rate = 0.85;

    const utterDef = new SpeechSynthesisUtterance(wObj.def);
    utterDef.voice = synthVoice;
    utterDef.rate = 0.95;

    utterWord.onend = () => {
        setTimeout(() => {
            window.speechSynthesis.speak(utterDef);
        }, 300);
    };

    window.speechSynthesis.speak(utterWord);
}

// Scroll / Swipe Handling using Scroll Snapping
let scrollTimeout = null;// Saved reel progress helper
function updateSavedReelIndex(idx) {
    if (appData.length === 0) {
        currentIndex = 0;
        return;
    }
    currentIndex = (idx >= 0 && idx < appData.length) ? idx : 0;
    localStorage.setItem('gre_reels_index', currentIndex);
    if (appData[currentIndex]) {
        localStorage.setItem('gre_reels_word', appData[currentIndex].word);
    }
}

function getResumeIndex(requestedIndex) {
    if (appData.length === 0) return 0;

    if (typeof requestedIndex === 'number' && !isNaN(requestedIndex) && requestedIndex >= 0 && requestedIndex < appData.length) {
        return requestedIndex;
    }

    // 1. If latest reel is imported, start from it
    const savedWord = localStorage.getItem('gre_reels_word');
    if (savedWord) {
        const foundWordIdx = appData.findIndex(w => w.word === savedWord);
        if (foundWordIdx !== -1) return foundWordIdx;
    }

    // 2. If target reel is not imported, start from the reel originally below it
    const savedIndex = parseInt(localStorage.getItem('gre_reels_index')) || 0;
    if (savedIndex >= 0 && savedIndex < appData.length) {
        return savedIndex;
    }

    // Search for next available imported reel at or after savedIndex
    for (let i = savedIndex; i < appData.length; i++) {
        if (appData[i]) return i;
    }

    // 3. Fallback to beginning (0)
    return 0;
}

let isProgrammaticScroll = false;

// Scroll position & swipe listener for reels feed
function setupScrollListener() {
    const feed = document.getElementById('reels-feed');
    if (!feed) return;

    feed.addEventListener('scroll', () => {
        if (isProgrammaticScroll || feed.classList.contains('hidden') || feed.offsetHeight === 0) return;

        const index = Math.round(feed.scrollTop / window.innerHeight);
        if (index < 0 || index >= appData.length) return;
        
        // Instant video playback as soon as user swipes past the 50% snap boundary
        if (index !== currentIndex) {
            const prevCard = document.querySelectorAll('.reel-card')[currentIndex];
            if (prevCard) {
                const video = prevCard.querySelector('.reel-video');
                if (video && !video.paused) {
                    video.pause();
                }
            }
            updateSavedReelIndex(index);
            closeComments();
            playActiveVideo(index);
        }
    });
}

// State Accessors (likes, bookmarks, learned) using local storage
function getLikeState(word) {
    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    return !!likes[word];
}

function toggleLike(e, word, index) {
    if (e) e.stopPropagation();
    const likes = JSON.parse(localStorage.getItem('gre_reels_likes')) || {};
    likes[word] = !likes[word];
    localStorage.setItem('gre_reels_likes', JSON.stringify(likes));

    const btn = document.getElementById(`like-btn-${index}`);
    const countEl = document.getElementById(`like-count-${index}`);
    if (btn && countEl) {
        const isLiked = likes[word];
        btn.innerHTML = `<svg class="w-[33px] h-[33px]" fill="${isLiked ? '#ef4444' : 'none'}" stroke="${isLiked ? '#ef4444' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
        </svg>`;
        const baseLikes = parseInt(countEl.getAttribute('data-base')) || 0;
        countEl.textContent = isLiked ? baseLikes + 1 : baseLikes;
    }
}

function getBookmarkState(word) {
    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    return !!saved[word];
}

function toggleBookmark(e, word, index) {
    if (e) e.stopPropagation();
    const saved = JSON.parse(localStorage.getItem('greSelectedLines')) || {};
    const isBookmarked = !saved[word];
    
    if (saved[word]) {
        delete saved[word];
    } else {
        // Save word template inside bookmarks
        const wordObj = appData[index];
        saved[word] = [{
            showKey: "Reels PWA",
            sentence: wordObj.example || "No sentence context recorded."
        }];
    }
    localStorage.setItem('greSelectedLines', JSON.stringify(saved));

    const btn = document.getElementById(`bookmark-btn-${index}`);
    if (btn) {
        btn.innerHTML = `<svg class="w-[27.5px] h-[27.5px] md:w-[22px] md:h-[22px]" fill="${isBookmarked ? '#ffffff' : 'none'}" stroke="${isBookmarked ? '#ffffff' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
        </svg>`;
    }
}

function getLearnedState(word) {
    const learned = JSON.parse(localStorage.getItem('learned-words')) || [];
    return learned.includes(word);
}

function getLearnedWords() {
    return JSON.parse(localStorage.getItem('learned-words')) || [];
}

function toggleLearned(e, word, index) {
    if (e) e.stopPropagation();
    let learned = JSON.parse(localStorage.getItem('learned-words')) || [];
    const isLearned = learned.includes(word);
    
    if (isLearned) {
        learned = learned.filter(w => w !== word);
    } else {
        learned.push(word);
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
    const drawer = document.getElementById('comments-drawer');
    const navbar = document.getElementById('bottom-navbar');
    
    // Load custom context data
    const wordObj = appData[index];
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
    // Set comments drawer max-height dynamically: 45.5vh for PWA, 39.5vh for Safari non-webapp
    const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isPC) {
        drawer.style.setProperty('max-height', isPWA ? '45.5vh' : '39.5vh', 'important');
    }

    // Shift active reel on PC (resizes video container height) and Mobile (translates Y)
    const card = document.querySelectorAll('.reel-card')[index];
    if (card) {
        card.classList.add('comments-active');
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
                target.style.setProperty('transform', `translateY(${getOpenVideoShiftY()})`, 'important');
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

function closeComments() {
    const drawer = document.getElementById('comments-drawer');
    const navbar = document.getElementById('bottom-navbar');
    commentsOpen = false;
    drawer.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    drawer.classList.add('translate-y-full');
    drawer.style.transform = ''; // Clear swipe drag inline transform!
    document.body.classList.remove('comments-open');
    setTimeout(() => {
        if (!commentsOpen) {
            drawer.style.visibility = 'hidden';
            drawer.classList.add('invisible');
        }
    }, 230);
    
    // Reset comments list scroll position to top
    const content = document.getElementById('comments-content-list');
    if (content) {
        content.scrollTop = 0;
    }
    
    // Remove smooth shift classes, inline heights, and inline transforms from all active reels
    document.querySelectorAll('.reel-card').forEach(c => {
        c.classList.remove('comments-active');
        const container = c.querySelector('.reel-video-container') || c.firstElementChild;
        if (container) {
            container.style.transition = 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
            container.style.removeProperty('height');
            container.style.removeProperty('max-height');
        }
        const video = c.querySelector('.reel-video');
        const fallback = c.querySelector('.audio-fallback');
        [video, fallback].forEach(target => {
            if (target) {
                target.style.transform = '';
                target.style.transition = '';
            }
        });
    });

    // Restore bottom navbar view
    commentsOpen = false;
    const isPC = window.innerWidth >= 768;
    if (isPC && currentTab === 'reels') {
        hideNavbarOnPCReels();
    } else {
        navbar.classList.remove('translate-y-full');
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
    if (!handle || !drawer) return;
    
    let isDragging = false;
    let startY = 0;
    let currentY = 0;
    
    let initialDrawerH = 0;

    const onStart = (e) => {
        isDragging = true;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        drawer.style.transition = 'none';
        handle.classList.add('notch-active');

        initialDrawerH = drawer.offsetHeight || (window.innerHeight * 0.46);

        // Ensure bottom navbar remains completely hidden on PC while comments section is active
        const navbar = document.getElementById('bottom-navbar');
        if (navbar && commentsOpen) {
            navbar.classList.add('translate-y-full');
            document.body.classList.add('navbar-hidden');
        }
        
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        if (container) container.style.transition = 'none';
        if (video) video.style.transition = 'none';
        if (fallback) fallback.style.transition = 'none';
    };
    
    const onMove = (e) => {
        if (!isDragging) return;
        currentY = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = currentY - startY;
        const clampedDelta = Math.max(0, delta);
        
        drawer.style.transform = `translateY(${clampedDelta}px)`;
        
        const isPC = window.innerWidth >= 768;
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        
        if (isPC) {
            if (container) {
                const currentVisibleH = Math.min(window.innerHeight, Math.max(150, (window.innerHeight - initialDrawerH) + clampedDelta));
                container.style.transition = 'none';
                container.style.setProperty('height', `${currentVisibleH}px`, 'important');
                container.style.setProperty('max-height', `${currentVisibleH}px`, 'important');
            }
        } else {
            const target = video || fallback;
            if (target) {
                const drawerHeight = initialDrawerH || (window.innerHeight * 0.44);
                const remainingRatio = Math.max(0, 1 - clampedDelta / drawerHeight);
                
                target.style.transformOrigin = 'center center';
                target.style.setProperty('transform', `translateY(calc(${getOpenVideoShiftY()} * ${remainingRatio}))`, 'important');
            }
        }
    };
    
    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('notch-active');
        
        drawer.style.transition = 'transform 0.3s ease-out';
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const container = activeCard ? (activeCard.querySelector('.reel-video-container') || activeCard.firstElementChild) : null;
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        if (container) container.style.transition = 'height 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
        
        const delta = currentY - startY;

        if (delta > window.innerHeight * 0.15) {
            // Pulled down past threshold -> close comments
            closeComments();
        } else {
            // Snap back to default upright open position
            drawer.style.transform = 'translateY(0px)';
            const isPC = window.innerWidth >= 768;
            if (isPC) {
                if (container) {
                    const targetTop = Math.max(150, window.innerHeight - initialDrawerH);
                    container.style.transition = 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                    container.style.setProperty('height', `${targetTop}px`, 'important');
                    container.style.setProperty('max-height', `${targetTop}px`, 'important');
                }
            } else {
                const target = video || fallback;
                if (target) {
                    target.style.transformOrigin = 'center center';
                    target.style.setProperty('transform', `translateY(${getOpenVideoShiftY()})`, 'important');
                }
            }
        }
        
        startY = 0;
        currentY = 0;
    };
    
    handle.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    
    handle.addEventListener('mousedown', onStart);
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

    if (target === 'reels') {
        if (currentTab === 'reels') return;
        selectReelFromDashboard(currentIndex);
    } else if (target === 'home') {
        if (currentTab === 'home') return;
        showMainDashboard();
    } else if (target === 'search') {
        if (currentTab === 'search') return;
        showSearchDashboard();
    }
}

// Select a reel from the dashboard and transition smoothly
function selectReelFromDashboard(index) {
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
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
    
    const targetIndex = (typeof index === 'number' && !isNaN(index) && index >= 0 && index < appData.length)
        ? index
        : getResumeIndex(index);
    updateSavedReelIndex(targetIndex);
    
    // Temporarily set scrollBehavior to auto so positioning is instant without fast scroll animation
    const originalBehavior = feed.style.scrollBehavior;
    feed.style.scrollBehavior = 'auto';
    
    // Unhide feed FIRST so the browser has layout dimensions for scroll snaps
    feed.classList.remove('hidden');
    
    // Set scroll position immediately to exact reel index
    const targetCard = feed.children[currentIndex];
    const scrollPos = targetCard ? targetCard.offsetTop : currentIndex * window.innerHeight;
    feed.scrollTop = scrollPos;
    
    // Restore smooth scroll behavior after frame paint
    requestAnimationFrame(() => {
        feed.scrollTop = scrollPos;
        setTimeout(() => {
            feed.style.scrollBehavior = originalBehavior;
        }, 60);
    });
    
    playActiveVideo(currentIndex);
    
    setTimeout(() => {
        isProgrammaticScroll = false;
    }, 250);
    
    // Instantly hide main and search screens to prevent black screen race conditions
    mainScreen.classList.add('hidden');
    mainScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    if (searchScreen) {
        searchScreen.classList.add('hidden');
        searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }
}

// Show the main dashboard and pause current playback
function showMainDashboard() {
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const feed = document.getElementById('reels-feed');
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
    closeComments();
    
    if (searchScreen) {
        searchScreen.classList.add('hidden');
        searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }
    
    // Instantly show main screen clean & ready
    mainScreen.classList.remove('hidden', 'opacity-0', 'scale-95', 'pointer-events-none');
    
    // Populate home stats
    const totalWords = appData.length;
    const learnedWords = getLearnedWords().length;
    const likesData = JSON.parse(localStorage.getItem('gre_reels_likes') || '{}');
    const likedCount = Object.keys(likesData).filter(k => likesData[k]).length;
    const homeStatWords = document.getElementById('home-stat-words');
    const homeStatLearned = document.getElementById('home-stat-learned');
    const homeStatLiked = document.getElementById('home-stat-liked');
    if (homeStatWords) homeStatWords.querySelector('span').textContent = totalWords;
    if (homeStatLearned) homeStatLearned.querySelector('span').textContent = learnedWords;
    if (homeStatLiked) homeStatLiked.querySelector('span').textContent = likedCount;
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
        return `<div onclick="selectReelFromDashboard(${reelIdx})" class="flex items-center justify-between py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition border border-white/5 mb-1">
            <div>
                <span class="text-white font-semibold text-sm">${w.word}</span>
                <span class="text-white/30 text-xs ml-2">${w.type}</span>
            </div>
            <span class="text-white/25 text-[11px]">${movieName}</span>
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
    const input = document.getElementById('import-clips-input');
    if (!input) return;
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

let isImportingClips = false;

function handleLocalClipsSelected(fileList) {
    if (isImportingClips) return;
    isImportingClips = true;
    setTimeout(() => { isImportingClips = false; }, 800);

    const input = document.getElementById('import-clips-input');
    const files = Array.from(fileList || []).filter(f => {
        if (!f || !f.name) return false;
        const name = String(f.name).toLowerCase();
        return name.endsWith('.mp4') || name.endsWith('.mov');
    });
    if (files.length === 0) {
        if (input) input.value = '';
        return;
    }

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

    const insertAt = appData.length > 0 ? Math.min(currentIndex + 1, appData.length) : 0;
    appData.splice(insertAt, 0, ...newEntries);

    renderReelsFeed();

    let msg = `${newEntries.length} new clip${newEntries.length === 1 ? '' : 's'} added`;
    if (duplicates.length > 0) {
        msg += ` (skipped duplicate${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')})`;
    }
    showToast(msg, 'success');

    currentTab = '';
    selectReelFromDashboard(insertAt);
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
});

// Helper to pause all video elements
function pauseAllVideos() {
    const videos = document.querySelectorAll('.reel-video');
    videos.forEach(v => {
        if (v && !v.paused) v.pause();
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
