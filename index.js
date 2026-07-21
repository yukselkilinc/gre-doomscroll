// STANDALONE DOOMSCROLL PWA LOGIC

let appData = [];
let currentIndex = 0;
let commentsOpen = false;
let doomscrollTempLikes = {};
let reelPauseStates = {};
let userHasInteracted = false;
let currentTab = 'home';

// Priority list to place at the very top
const PRIORITY_WORDS = ["calumny", "perfidious", "renege", "moribund"];

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

        appData = priorityWords.concat(normalWords);
        console.log(`Loaded ${appData.length} video words out of GRE-Essential.`);

        if (appData.length === 0) {
            document.getElementById('reels-feed').innerHTML = `
                <div class="flex flex-col items-center justify-center h-full p-6 text-center">
                    <p class="text-slate-400 text-lg mb-2">No videos synced yet.</p>
                    <p class="text-sm text-slate-600">Please make sure to run sync_videos.py to detect your videos folder.</p>
                </div>
            `;
            return;
        }

        // Restore last view state (card index only, tab always starts on Home)
        const savedIndex = parseInt(localStorage.getItem('gre_reels_index'));
        currentIndex = (!isNaN(savedIndex) && savedIndex >= 0 && savedIndex < appData.length) ? savedIndex : 0;
        currentTab = 'home';

        renderReelsFeed();
        makeDrawerDraggable();

        // Pre-position reels feed to saved reel index immediately without animation
        const feed = document.getElementById('reels-feed');
        if (feed && currentIndex > 0) {
            feed.style.scrollBehavior = 'auto';
            feed.scrollTop = currentIndex * window.innerHeight;
        }

        // Register scroll listener after pre-positioning
        setupScrollListener();

        // Initialize sliding active tab bubble position on load (instantly)
        setTimeout(() => {
            positionNavbarBubble(currentTab);
            // Enable transitions for subsequent navigation clicks
            setTimeout(() => {
                const bubble = document.getElementById('navbar-bubble');
                if (bubble) {
                    bubble.classList.add('transition-all', 'duration-300', 'ease-out');
                }
            }, 50);
        }, 50);

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

// Render Swipable Reels Cards
function renderReelsFeed() {
    const feed = document.getElementById('reels-feed');
    feed.innerHTML = '';

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
            ? `<svg class="w-[22px] h-[22px] pointer-events-none" viewBox="0 0 24 24">
                   <circle cx="12" cy="12" r="10" fill="white" stroke="white" stroke-width="1.6"></circle>
                   <path stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"></path>
               </svg>`
            : `<svg class="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24">
                   <circle cx="12" cy="12" r="10"></circle>
                   <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"></path>
               </svg>`;
        
        // Movie/TV Show display name
        const movieName = w.show || w.source || (typeof VIDEO_SHOWS !== 'undefined' && VIDEO_SHOWS[w.word]) || "GRE-Essential";

        card.innerHTML = `
            <!-- Video & Audio Fallback Container -->
            <div class="w-full h-full relative flex items-center justify-center bg-black" onclick="handleCardClick(event, ${idx})">
                <video class="reel-video" src="videos/${w.word}.mp4" preload="${idx <= 2 ? 'auto' : 'metadata'}" loop playsinline></video>
                
                <!-- Fallback card for missing video -->
                <div class="absolute inset-0 hidden audio-fallback bg-gradient-to-br from-slate-900 via-neutral-900 to-teal-950 flex flex-col items-center justify-center p-8 text-center">
                    <div class="flex gap-1.5 items-end h-10 mb-6">
                        <span class="wave-bar wave-bar-1"></span>
                        <span class="wave-bar wave-bar-2"></span>
                        <span class="wave-bar wave-bar-3"></span>
                        <span class="wave-bar wave-bar-4"></span>
                        <span class="wave-bar wave-bar-5"></span>
                    </div>
                    <h2 class="text-4xl sm:text-5xl font-serif font-black text-teal-400 capitalize mb-3 tracking-wide">${w.word}</h2>
                    <span class="px-3 py-1 bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded-full text-xs font-mono uppercase tracking-wider">${w.type}</span>
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

            <!-- Bottom Left Info Overlay -->
            <div class="word-info-overlay max-w-[70vw] md:max-w-[65vw]">
                <h2 class="text-2xl md:text-[36px] leading-tight font-serif font-extrabold text-white tracking-wide flex items-center gap-2 flex-wrap">
                    <span class="capitalize">${w.word}</span>
                    <span class="text-xs md:text-[18px] font-sans italic text-white/80 lowercase">${w.type}</span>
                </h2>
                <p class="text-sm md:text-[21px] font-medium text-white/90 leading-relaxed mt-2 max-w-full break-words whitespace-normal">${w.def}</p>
                <div class="flex items-center gap-1.5 md:gap-2 mt-2.5 md:mt-3.5 bg-black/40 backdrop-blur-md px-3 py-1 md:px-3.5 md:py-2 rounded-full border border-white/10 w-fit">
                    <svg class="w-3 h-3 md:w-[18px] md:h-[18px] text-white fill-current shrink-0" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <span class="text-[11px] md:text-[16.5px] font-semibold text-white/90 truncate max-w-[160px] md:max-w-[220px]">${movieName}</span>
                </div>
            </div>

            <!-- Vertical Action Sidebar -->
            <div class="action-tray">
                <!-- Like -->
                <div class="flex flex-col items-center">
                    <button onclick="toggleLike(event, '${w.word}', ${idx})" class="action-btn" id="like-btn-${idx}">
                        <svg class="w-[22px] h-[22px]" fill="${heartFillColor}" stroke="${heartStrokeColor}" stroke-width="1.8" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                        </svg>
                    </button>
                    <span id="like-count-${idx}" data-base="${baseLikes}" class="text-[10px] font-bold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] mt-0.5 select-none" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${displayLikes}</span>
                </div>

                <!-- Comments -->
                <div class="flex flex-col items-center">
                    <button onclick="openComments(event, ${idx})" class="action-btn">
                        <svg class="w-[22px] h-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                        </svg>
                    </button>
                    <span class="text-[10px] font-bold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] mt-0.5 select-none" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">3</span>
                </div>

                <!-- Bookmark -->
                <button onclick="toggleBookmark(event, '${w.word}', ${idx})" class="action-btn" id="bookmark-btn-${idx}">
                    <svg class="w-[22px] h-[22px]" fill="${bookmarkFillColor}" stroke="${bookmarkStrokeColor}" stroke-width="1.8" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
                    </svg>
                </button>

                <!-- Mark Learned / Master -->
                <button onclick="toggleLearned(event, '${w.word}', ${idx})" class="action-btn" id="learned-btn-${idx}">
                    ${masterSvg}
                </button>
            </div>
        `;

        const video = card.querySelector('.reel-video');
        const fallback = card.querySelector('.audio-fallback');

        // Fallback listener in case video file is missing or fails to load
        video.addEventListener('error', () => {
            video.classList.add('hidden');
            fallback.classList.remove('hidden');
            if (idx === currentIndex && userHasInteracted) {
                speakActiveWord(idx);
            }
        });

        // Record video playback position and timestamp when it is paused
        video.addEventListener('pause', () => {
            reelPauseStates[idx] = {
                currentTime: video.currentTime,
                pausedAt: Date.now()
            };
        });

        // Trigger active playback once the active card's video loads (fix after video loads, not at the beginning)
        video.addEventListener('canplay', () => {
            if (idx === currentIndex && video.paused) {
                playActiveVideo(idx);
            }
        }, { once: true });

        // Listen to loadedmetadata to update max-width as soon as video aspect ratio is known
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
        if (!overlay) return;
        const p = overlay.querySelector('p');
        if (!p) return;
        
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
            // Allow definition text to use full black space, stopping 16px BEFORE video content left edge
            const maxW = Math.max(180, Math.floor(actualVideoLeft - overlayLeft - 16));
            
            p.style.maxWidth = `${maxW}px`;
            p.style.wordBreak = 'break-word';
            p.style.whiteSpace = 'normal';
        } else {
            p.style.maxWidth = ''; // Mobile default
        }
    });
}

// Play active video card, pause all others
function playActiveVideo(index) {
    updateDefinitionMaxWidths();
    const cards = document.querySelectorAll('.reel-card');
    cards.forEach((card, idx) => {
        const video = card.querySelector('.reel-video');
        if (idx === index) {
            if (video && !video.classList.contains('hidden')) {
                // Ensure active video is fully preloaded
                video.setAttribute('preload', 'auto');
                
                if (video.paused) {
                    // Check if we have a recorded pause state within the 2 seconds limit
                    const state = reelPauseStates[index];
                    const now = Date.now();
                    if (state && (now - state.pausedAt < 2000)) {
                        video.currentTime = state.currentTime;
                    } else {
                        video.currentTime = 0;
                    }
                    
                    if (userHasInteracted) {
                        video.muted = false;
                        video.play().catch(e => console.log("Play failed: ", e));
                    }
                }
            } else {
                if (userHasInteracted) {
                    speakActiveWord(idx);
                }
            }
        } else {
            if (video) {
                video.pause();
                // Predictive Background Preloading for nearby cards to eliminate lag
                if (idx === index + 1 || idx === index + 2) {
                    if (video.getAttribute('preload') !== 'auto') {
                        video.setAttribute('preload', 'auto');
                        video.load(); // Request browser buffer
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
function handleCardClick(e, index) {
    if (e.target.closest('button') || e.target.closest('.word-info-overlay')) {
        return;
    }

    // If comments drawer is open, close it and do NOT toggle media playback
    const drawer = document.getElementById('comments-drawer');
    if (drawer && !drawer.classList.contains('translate-y-full')) {
        closeComments();
        return;
    }

    const now = Date.now();
    if (now - lastTap < 300) {
        // Double-Tap detected! Cancel the single-tap play/pause timeout
        if (tapTimeout) {
            clearTimeout(tapTimeout);
            tapTimeout = null;
        }
        handleDoubleTapLike(e, index);
    } else {
        // Single tap: set a timeout to toggle play/pause after 250ms
        if (tapTimeout) {
            clearTimeout(tapTimeout);
        }
        tapTimeout = setTimeout(() => {
            const video = document.querySelectorAll('.reel-card')[index].querySelector('.reel-video');
            if (video && !video.classList.contains('hidden')) {
                if (video.paused) {
                    video.play().catch(e => {});
                    showPlayPauseOverlay(index, true);
                } else {
                    video.pause();
                    showPlayPauseOverlay(index, false);
                }
            }
            tapTimeout = null;
        }, 250);
    }
    lastTap = now;
}

// Single-tap play/pause splash feedback
function showPlayPauseOverlay(index, isPlay) {
    const card = document.querySelectorAll('.reel-card')[index];
    const overlay = card.querySelector('.play-pause-overlay');
    if (!overlay) return;

    overlay.innerHTML = isPlay 
        ? `<div class="p-4 bg-black/40 rounded-full text-white"><svg class="w-10 h-10" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg></div>`
        : `<div class="p-4 bg-black/40 rounded-full text-white"><svg class="w-10 h-10" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg></div>`;
        
    overlay.style.opacity = '1';
    setTimeout(() => {
        overlay.style.opacity = '0';
    }, 450);
}

// Double tap Heart Pop & Fly Animation (smoothly and rapidly travels into the heart button)
function handleDoubleTapLike(e, index) {
    const card = document.querySelectorAll('.reel-card')[index];
    if (!card) return;
    const word = card.dataset.word;
    
    // Set liked state to true (double tap never unlikes)
    if (!getLikeState(word)) {
        toggleLike(null, word, index);
    } else {
        // Even if already liked, trigger the heart button bounce
        const btn = document.getElementById(`like-btn-${index}`);
        if (btn) {
            btn.style.transform = 'scale(1.4)';
            btn.style.transition = 'transform 0.1s ease';
            setTimeout(() => { btn.style.transform = 'scale(1)'; }, 100);
        }
    }

    // Spawn heart animation at pointer position (relative to card container)
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const heart = document.createElement('div');
    heart.style.position = 'absolute';
    heart.style.left = `${x}px`;
    heart.style.top = `${y}px`;
    heart.style.transform = 'translate(-50%, -50%) scale(0.1)';
    heart.style.opacity = '0';
    heart.style.zIndex = '100';
    heart.style.pointerEvents = 'none';
    heart.style.transition = 'transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.15s ease-out';
    heart.innerHTML = `<svg class="w-16 h-16 text-red-500 fill-current drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    
    card.appendChild(heart);

    // Step 1: Pop heart up to full scale
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            heart.style.transform = 'translate(-50%, -50%) scale(1.4)';
            heart.style.opacity = '1';
        });
    });

    // Step 2: After a short delay, travel to the heart button and shrink
    setTimeout(() => {
        const likeBtn = document.getElementById(`like-btn-${index}`);
        if (likeBtn) {
            const btnRect = likeBtn.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const destX = btnRect.left + btnRect.width / 2 - cardRect.left;
            const destY = btnRect.top + btnRect.height / 2 - cardRect.top;

            heart.style.transition = 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), top 0.4s cubic-bezier(0.25, 1, 0.5, 1), transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease-in';
            heart.style.left = `${destX}px`;
            heart.style.top = `${destY}px`;
            heart.style.transform = 'translate(-50%, -50%) scale(0.1)';
            heart.style.opacity = '0.3';
        } else {
            // Fallback: fade out if no button
            heart.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            heart.style.transform = 'translate(-50%, -50%) scale(0.1)';
            heart.style.opacity = '0';
        }

        // Step 3: Remove element and trigger button catch bounce animation
        setTimeout(() => {
            heart.remove();
            const btn = document.getElementById(`like-btn-${index}`);
            if (btn) {
                btn.style.transform = 'scale(1.4)';
                btn.style.transition = 'transform 0.1s ease';
                setTimeout(() => {
                    btn.style.transform = 'scale(1)';
                }, 100);
            }
        }, 400);

    }, 220);
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
let scrollTimeout = null;
function setupScrollListener() {
    const feed = document.getElementById('reels-feed');
    if (!feed) return;
    feed.addEventListener('scroll', () => {
        // Ignore scroll events if feed is hidden or unrendered
        if (feed.classList.contains('hidden') || feed.offsetHeight === 0) return;

        const index = Math.round(feed.scrollTop / window.innerHeight);
        if (index < 0 || index >= appData.length) return;
        
        // Only pause the previous card if we cross the 50% scroll snap boundary (index shifts)
        if (index !== currentIndex) {
            const prevCard = document.querySelectorAll('.reel-card')[currentIndex];
            if (prevCard) {
                const video = prevCard.querySelector('.reel-video');
                if (video && !video.paused) {
                    video.pause();
                }
            }
            currentIndex = index;
            localStorage.setItem('gre_reels_index', currentIndex);
            closeComments();
        }
        
        // Debounce video playback until scrolling settles (120ms covers fast flick gestures)
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(() => {
            playActiveVideo(currentIndex);
        }, 120);
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
        btn.innerHTML = `<svg class="w-[22px] h-[22px]" fill="${isLiked ? '#ef4444' : 'none'}" stroke="${isLiked ? '#ef4444' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
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
        btn.innerHTML = `<svg class="w-[22px] h-[22px]" fill="${isBookmarked ? '#ffffff' : 'none'}" stroke="${isBookmarked ? '#ffffff' : 'currentColor'}" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
        </svg>`;
    }
}

function getLearnedState(word) {
    const learned = JSON.parse(localStorage.getItem('learned-words')) || [];
    return learned.includes(word);
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
             ? `<svg class="w-[22px] h-[22px] pointer-events-none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="white" stroke="white" stroke-width="1.6"></circle>
                    <path stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M9 12l2 2 4-4"></path>
                </svg>`
             : `<svg class="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24">
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
    toast.className = 'fixed left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-xl shadow-2xl text-xs font-semibold ' + colors;
    toast.style.top = 'calc(env(safe-area-inset-top) + 2.5rem)';
    toast.textContent = message;
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '1';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 1500);
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
                        <span class="font-bold mr-1 text-slate-900 dark:text-white">@gre_essential</span>
                        <svg class="w-3.5 h-3.5 inline text-blue-500 fill-current mr-1.5 relative -translate-y-[1px]" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        
                        <!-- Simple word card "image" mockup -->
                        <div class="my-2.5 p-4 rounded-xl border border-slate-200/60 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900/60 flex flex-col items-center justify-center text-center shadow-sm select-none">
                            <span class="text-xl font-serif font-black text-slate-800 dark:text-white lowercase tracking-wide">${wordObj.word}</span>
                            <span class="text-[10px] text-slate-450 dark:text-neutral-500 italic mt-0.5 lowercase">${wordObj.type}</span>
                        </div>
                        
                        <p class="leading-relaxed mt-2 text-slate-700 dark:text-neutral-300">${wordObj.def}</p>
                    </div>
                    <!-- Footer Actions -->
                    <div class="flex items-center gap-3 text-[10px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Instagram Style) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${greBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${greKey}">
                    <svg class="w-[14px] h-[14px]" fill="${greFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="text-xs text-slate-400 dark:text-neutral-500 mt-0.5 like-count" data-base="${greLikes}">${greDisplay}</span>
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
                        <span class="font-bold text-slate-900 dark:text-white">@example_sentence</span>
                        <svg class="w-2.5 h-2.5 text-red-500 fill-current inline-block" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                        <span class="text-[10px] text-slate-400 dark:text-neutral-500">by author</span>
                    </div>
                    <p class="leading-relaxed mt-1 text-slate-700 dark:text-neutral-300">${highlightedEx}</p>
                    <!-- Footer Actions -->
                    <div class="flex items-center gap-3 text-[10px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Instagram Style) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${exBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${exKey}">
                    <svg class="w-[14px] h-[14px]" fill="${exFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="text-xs text-slate-400 dark:text-neutral-500 mt-0.5 like-count" data-base="${exLikes}">${exDisplay}</span>
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
                        <span class="font-bold text-slate-900 dark:text-white">@long_example</span>
                        <svg class="w-2.5 h-2.5 text-red-500 fill-current inline-block" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                        <span class="text-[10px] text-slate-400 dark:text-neutral-500">by author</span>
                    </div>
                    <p class="leading-relaxed mt-1 text-slate-700 dark:text-neutral-300">${highlightedLong}</p>
                    <!-- Footer Actions -->
                    <div class="flex items-center gap-3 text-[10px] text-slate-400 dark:text-neutral-500 mt-1 select-none">
                        <span>2w</span>
                        <span class="font-bold hover:text-slate-600 dark:hover:text-neutral-300 cursor-pointer">Reply</span>
                    </div>
                </div>
            </div>
            <!-- Like Heart (Instagram Style) -->
            <div class="flex flex-col items-center shrink-0 mt-1 select-none">
                <button class="${longBtnClass}" onclick="toggleDoomscrollCommentLike(this)" data-like-key="${longKey}">
                    <svg class="w-[14px] h-[14px]" fill="${longFill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </button>
                <span class="text-xs text-slate-400 dark:text-neutral-500 mt-0.5 like-count" data-base="${longLikes}">${longDisplay}</span>
            </div>
        </div>`;
    }
    
    content.innerHTML = commentsHtml || '<p class="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No context available.</p>';
    
    // Open Comments drawer and hide bottom navbar immediately
    drawer.style.transition = 'transform 0.3s ease-out';
    drawer.style.transform = '';
    drawer.classList.remove('translate-y-full');
    navbar.classList.add('translate-y-full');
    commentsOpen = true;

    // Shift active reel to the top safe area
    const card = document.querySelectorAll('.reel-card')[index];
    if (card) {
        card.classList.add('comments-active');
    }

    // Lock reels feed scrolling
    const feed = document.getElementById('reels-feed');
    if (feed) {
        feed.style.overflowY = 'hidden';
    }
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
    
    drawer.style.transition = 'transform 0.3s ease-out';
    drawer.classList.add('translate-y-full');
    drawer.style.transform = ''; // Clear swipe drag inline transform!
    
    // Reset comments list scroll position to top
    const content = document.getElementById('comments-content-list');
    if (content) {
        content.scrollTop = 0;
    }
    
    // Remove smooth shift classes and inline transforms from all active reels
    document.querySelectorAll('.reel-card').forEach(c => {
        c.classList.remove('comments-active');
        const video = c.querySelector('.reel-video');
        const fallback = c.querySelector('.audio-fallback');
        if (video) {
            video.style.transform = '';
            video.style.transition = '';
        }
        if (fallback) {
            fallback.style.transform = '';
            fallback.style.transition = '';
        }
    });

    // Restore bottom navbar view
    navbar.classList.remove('translate-y-full');
    commentsOpen = false;

    // Restore reels feed scrolling
    const feed = document.getElementById('reels-feed');
    if (feed) {
        feed.style.overflowY = 'scroll';
    }
}

// Make Comments Drawer draggable downwards (notch ONLY moves down to close/reveal video)
function makeDrawerDraggable() {
    const handle = document.getElementById('comments-drag-handle');
    const drawer = document.getElementById('comments-drawer');
    if (!handle || !drawer) return;
    
    let isDragging = false;
    let startY = 0;
    let currentY = 0;
    
    const onStart = (e) => {
        isDragging = true;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        drawer.style.transition = 'none';
        handle.classList.add('notch-active');
        
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        if (video) video.style.transition = 'none';
        if (fallback) fallback.style.transition = 'none';
    };
    
    const onMove = (e) => {
        if (!isDragging) return;
        currentY = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = currentY - startY;
        
        // Comment section can absolutely NOT move upwards; notch ONLY moves down
        const clampedDelta = Math.max(0, delta);
        drawer.style.transform = `translateY(${clampedDelta}px)`;
        
        // Dynamically resize / shift active video in real-time on both Mobile and PC
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        const isPC = window.innerWidth >= 768;
        
        if (isPC) {
            if (video) {
                const pcScale = Math.max(0.7, 1.1 - (clampedDelta / window.innerHeight) * 0.6);
                const pcShiftY = clampedDelta * 0.3;
                video.style.transform = `scale(${pcScale}) translateY(${pcShiftY}px)`;
            }
        } else {
            const target = video || fallback;
            if (target) {
                // Baseline shift when open is translateY(calc(env(safe-area-inset-top, 48px) - 20vh))
                // As notch moves down by clampedDelta, progress goes 0 -> 1 and video follows notch back to original location (0)
                const drawerHeight = window.innerHeight * 0.45;
                const remainingRatio = Math.max(0, 1 - clampedDelta / drawerHeight);
                target.style.transform = `translateY(calc((env(safe-area-inset-top, 48px) - 20vh) * ${remainingRatio}))`;
            }
        }
    };
    
    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('notch-active');
        
        drawer.style.transition = 'transform 0.3s ease-out';
        const activeCard = document.querySelectorAll('.reel-card')[currentIndex];
        const video = activeCard ? activeCard.querySelector('.reel-video') : null;
        const fallback = activeCard ? activeCard.querySelector('.audio-fallback') : null;
        if (video) video.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
        if (fallback) fallback.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
        
        const delta = currentY - startY;

        if (delta > window.innerHeight * 0.15) {
            // Pulled down past threshold -> close comments
            closeComments();
        } else {
            // Snap back to default open position
            drawer.style.transform = 'translateY(0)';
            if (video) video.style.transform = '';
            if (fallback) fallback.style.transform = '';
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

// Bottom Navbar Click Interactions
function onNavClick(target) {
    if (target === 'send' || target === 'profile') {
        // Can't be selected at all
        return;
    }
    
    if (target === 'reels') {
        if (currentTab === 'reels') {
            // Already on reels page, do nothing to refresh/reload
            return;
        }
        selectReelFromDashboard(currentIndex);
    } else if (target === 'home') {
        showMainDashboard();
    } else if (target === 'search') {
        showSearchDashboard();
    }
}

// Position sliding active tab bubble dynamically over target navbar button
function positionNavbarBubble(tab) {
    const bubble = document.getElementById('navbar-bubble');
    const btn = document.getElementById(`nav-btn-${tab}`);
    const nav = document.getElementById('bottom-navbar');
    if (!bubble || !btn || !nav) return;
    
    const btnRect = btn.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    
    // Position bubble relative to bottom-navbar container
    bubble.style.width = `${btnRect.width}px`;
    bubble.style.height = `${btnRect.height}px`;
    bubble.style.left = `${btnRect.left - navRect.left}px`;
    bubble.style.top = `${btnRect.top - navRect.top}px`;
    bubble.style.opacity = '1';
    
    // Highlight active text and dim inactive texts
    ['home', 'search', 'reels'].forEach(t => {
        const b = document.getElementById(`nav-btn-${t}`);
        if (b) {
            if (t === tab) {
                b.classList.remove('text-white/50');
                b.classList.add('text-white');
                b.style.transform = 'scale(1.1)'; // Keep slight active zoom
            } else {
                b.classList.remove('text-white');
                b.classList.add('text-white/50');
                b.style.transform = '';
            }
        }
    });
}

// Select a reel from the dashboard and transition smoothly
function selectReelFromDashboard(index) {
    const mainScreen = document.getElementById('main-screen');
    const searchScreen = document.getElementById('search-screen');
    const feed = document.getElementById('reels-feed');
    if (!mainScreen || !feed) return;
    
    userHasInteracted = true;
    pauseAllVideos();
    
    currentTab = 'reels';
    positionNavbarBubble('reels');
    
    const targetIndex = (typeof index === 'number' && !isNaN(index))
        ? index
        : (parseInt(localStorage.getItem('gre_reels_index')) || 0);
        
    currentIndex = (targetIndex >= 0 && targetIndex < appData.length) ? targetIndex : 0;
    localStorage.setItem('gre_reels_index', currentIndex);
    
    // Temporarily set scrollBehavior to auto so positioning is instant without fast scroll animation
    const originalBehavior = feed.style.scrollBehavior;
    feed.style.scrollBehavior = 'auto';
    
    // Unhide feed FIRST so the browser has layout dimensions for scroll snaps
    feed.classList.remove('hidden');
    
    // Set scroll position immediately to exact reel index
    feed.scrollTop = currentIndex * window.innerHeight;
    
    // Restore smooth scroll behavior after frame paint
    requestAnimationFrame(() => {
        feed.scrollTop = currentIndex * window.innerHeight;
        setTimeout(() => {
            feed.style.scrollBehavior = originalBehavior;
        }, 60);
    });
    
    playActiveVideo(currentIndex);
    
    // Add fade out transitions in the background
    mainScreen.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    if (searchScreen) {
        searchScreen.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    }
    
    setTimeout(() => {
        mainScreen.classList.add('hidden');
        mainScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
        if (searchScreen) {
            searchScreen.classList.add('hidden');
            searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
        }
    }, 300);
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
    
    feed.classList.add('hidden');
    closeComments();
    
    if (searchScreen) {
        searchScreen.classList.add('hidden');
    }
    
    mainScreen.classList.remove('hidden');
    mainScreen.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    
    requestAnimationFrame(() => {
        // Smoothly fade in main screen
        mainScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    });
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
    
    feed.classList.add('hidden');
    closeComments();
    
    if (mainScreen) {
        mainScreen.classList.add('hidden');
    }
    
    searchScreen.classList.remove('hidden');
    searchScreen.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    
    requestAnimationFrame(() => {
        // Smoothly fade in search screen
        searchScreen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    });
}

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
