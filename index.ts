import * as marked from 'marked';
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, User } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, limit, doc, setDoc, where, updateDoc, getDocs, getDoc, deleteDoc
} from 'firebase/firestore';
import Chart from 'chart.js/auto';
import Peer, { MediaConnection } from 'peerjs';
import { NexusVault } from './encryption-wrapper';
import firebaseConfig from './firebase-applet-config.json';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
const auth = getAuth();
const provider = new GoogleAuthProvider();

// --- DOM Elements ---
const chatMessages = document.getElementById('chat-messages') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const flagDescriptionInput = document.getElementById('flag-description') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const typingStatus = document.getElementById('typing-status') as HTMLElement;
const modeFree = document.getElementById('mode-free') as HTMLButtonElement;
const modeIykyk = document.getElementById('mode-iykyk') as HTMLButtonElement;
const wordCountDisplay = document.getElementById('word-count-display') as HTMLElement;
const useExtensionBtn = document.getElementById('use-extension') as HTMLButtonElement;
const toggleFlagBtn = document.getElementById('toggle-flag') as HTMLButtonElement;
const flagPicker = document.getElementById('flag-picker') as HTMLElement;
const unlockUi = document.getElementById('unlock-ui') as HTMLElement;
const currentFlagText = document.getElementById('current-flag-text') as HTMLElement;
const currentFlagDesc = document.getElementById('current-flag-desc') as HTMLElement;
const resolveBtn = document.getElementById('resolve-btn') as HTMLButtonElement;
const moodBar = document.getElementById('mood-bar') as HTMLElement;
const moodVal = document.getElementById('mood-val') as HTMLElement;
const counselingAgenda = document.getElementById('counseling-agenda') as HTMLElement;
const lockedBadge = document.getElementById('locked-badge') as HTMLElement;
const authBtn = document.getElementById('auth-btn') as HTMLButtonElement;
const voiceCallBtn = document.getElementById('voice-call-btn') as HTMLButtonElement;
const videoCallBtn = document.getElementById('video-call-btn') as HTMLButtonElement;
const callOverlay = document.getElementById('call-overlay') as HTMLElement;
const callStatus = document.getElementById('call-status') as HTMLElement;
const callPeerId = document.getElementById('call-peer-id') as HTMLElement;
const endCallBtn = document.getElementById('end-call-btn') as HTMLButtonElement;
const remoteAudio = document.getElementById('remote-audio') as HTMLAudioElement;
const mySynapseId = document.getElementById('my-synapse-id') as HTMLElement;
const copyMyIdBtn = document.getElementById('copy-my-id') as HTMLElement;

// View Elements
const views = {
  home: document.getElementById('view-home') as HTMLElement,
  contacts: document.getElementById('view-contacts') as HTMLElement,
  chat: document.getElementById('view-chat') as HTMLElement,
  advancement: document.getElementById('view-advancement') as HTMLElement,
  calendar: document.getElementById('view-calendar') as HTMLElement,
  survey: document.getElementById('view-survey') as HTMLElement
};
const navBtns = {
  home: document.getElementById('nav-btn-home') as HTMLButtonElement,
  contacts: document.getElementById('nav-btn-contacts') as HTMLButtonElement,
  chat: document.getElementById('nav-btn-chat') as HTMLButtonElement,
  advancement: document.getElementById('nav-btn-advancement') as HTMLButtonElement,
  calendar: document.getElementById('nav-btn-calendar') as HTMLButtonElement,
  survey: document.getElementById('nav-btn-survey') as HTMLButtonElement
};

// Master Key Modal
const masterKeyModal = document.getElementById('master-key-modal') as HTMLElement;
const masterKeyForm = document.getElementById('master-key-form') as HTMLFormElement;
const masterKeyInput = document.getElementById('master-key-input') as HTMLInputElement;

// --- Crypto Wrapper ---
let masterKey: CryptoKey | null = null;
const SALT = new TextEncoder().encode("NEXUS_SALT_1234");

masterKeyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = masterKeyInput.value.trim();
  if (pwd) {
    masterKey = await NexusVault.deriveKey(pwd, SALT);
    masterKeyModal.classList.add('hidden');
    // If auth is already ready, load messages since we now have the key
    if (currentUser) {
       chatMessages.innerHTML = '<div class="flex flex-col items-center justify-center py-20 opacity-10"><div class="w-24 h-24 bg-gray-200 rounded-full blur-3xl absolute"></div><p class="text-[10px] font-black tracking-[0.4em] uppercase text-gray-500 mb-8">Nexus Established</p></div>';
       loadSurveyData();
       setupMessageListener();
    }
  }
});

let currentUser: User | null = null;
let currentSurveyData: any = null;
let isIykykMode = false;
let isLocked = false;
let currentFlag: string | null = null;
let extensionsUsed = 0;
const MAX_EXTENSIONS = 2;
const BASE_WORD_LIMIT = 15;
let currentWordLimit = BASE_WORD_LIMIT;

// PeerJS State
let peer: Peer | null = null;
let currentCall: MediaConnection | null = null;
let localStream: MediaStream | null = null;

// --- AI Logic ---
function getWordCount(str: string): number {
  return str.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function updateWordCounter() {
  const count = getWordCount(chatInput.value);
  wordCountDisplay.textContent = `${count} / ${isIykykMode ? currentWordLimit : '∞'} Words`;
  
  if (isIykykMode && count > currentWordLimit) {
    wordCountDisplay.classList.add('word-warning');
    sendButton.disabled = true;
  } else {
    wordCountDisplay.classList.remove('word-warning');
    sendButton.disabled = !currentUser || count === 0;
  }
}

function createMessageElement(
  text: string, 
  isAI: boolean, 
  senderName: string = "AI", 
  flag: string | null = null, 
  desc: string = "", 
  isIykyk: boolean = false,
  messageId: string | null = null,
  reactions: Record<string, string[]> | null = null
): HTMLElement {
  const container = document.createElement('div');
  container.className = `flex flex-col ${isAI ? 'items-start' : 'items-end'} w-full animate-msg group relative`;
  
  const meta = document.createElement('div');
  meta.className = 'text-[9px] font-black uppercase text-gray-400 mb-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between gap-4';
  meta.textContent = senderName;
  container.appendChild(meta);

  if (flag) {
    const badge = document.createElement('div');
    badge.className = 'flag-badge ml-2';
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg> ${flag}${desc ? ': ' + desc : ''}`;
    container.appendChild(badge);
  }

  const bubbleWrapper = document.createElement('div');
  bubbleWrapper.className = `relative flex items-center gap-2 ${isAI ? 'flex-row' : 'flex-row-reverse'}`;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isAI ? 'ai-bubble shadow-sm' : 'user-bubble'} ${flag ? 'flagged-bubble !text-black border-black/10' : ''} ${isIykyk ? 'iykyk-bubble' : ''}`;
  
  if (isAI) {
    bubble.innerHTML = marked.parse(text) as string;
  } else {
    bubble.textContent = text;
  }

  if (!isAI) {
    bubble.addEventListener('click', () => handleInterpretation(text));
    bubble.title = "Tap for Neural Interpretation";
    bubble.style.cursor = "pointer";
  }

  bubbleWrapper.appendChild(bubble);

  if (messageId) {
    const actionsMenu = document.createElement('div');
    actionsMenu.className = `opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white/80 backdrop-blur shadow-sm p-1 rounded-full border border-gray-100 ${isAI ? '' : 'flex-row-reverse'}`;
    
    // Emojis
    const emojis = ['👍', '❤️', '🔥', '😂'];
    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.className = 'w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/5 text-xs transition-colors hover:scale-110';
      btn.onclick = () => (window as any).toggleReaction(messageId, emoji);
      actionsMenu.appendChild(btn);
    });

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>';
    deleteBtn.className = 'w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors ml-1';
    deleteBtn.onclick = () => {
      if (confirm('Are you sure you want to delete this message?')) {
        (window as any).deleteMessage(messageId);
      }
    };
    actionsMenu.appendChild(deleteBtn);
    bubbleWrapper.appendChild(actionsMenu);
  }

  container.appendChild(bubbleWrapper);

  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = `reactions-container flex gap-1 mt-1 ${isAI ? 'justify-start' : 'justify-end'}`;
  container.appendChild(reactionsDiv);

  if (reactions) {
    updateReactionsUI(container, reactions);
  }

  return container;
}

(window as any).toggleReaction = async (messageId: string, emoji: string) => {
  if (!currentUser) return;
  const docRef = doc(db, 'messages', messageId);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const reactions = data.reactions || {};
      const emojiUsers = reactions[emoji] || [];
      if (emojiUsers.includes(currentUser.uid)) {
        reactions[emoji] = emojiUsers.filter((uid: string) => uid !== currentUser.uid);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...emojiUsers, currentUser.uid];
      }
      await updateDoc(docRef, { reactions });
    }
  } catch (e) {
    console.error(e);
  }
};

(window as any).deleteMessage = async (messageId: string) => {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(db, 'messages', messageId));
  } catch (e) {
    console.error('Failed to delete message', e);
  }
};

function updateReactionsUI(msgEl: HTMLElement, reactions: Record<string, string[]> | null) {
  const container = msgEl.querySelector('.reactions-container');
  if (!container) return;
  container.innerHTML = '';
  
  if (!reactions) return;

  Object.entries(reactions).forEach(([emoji, users]) => {
    if (users.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'px-1.5 py-0.5 bg-white border border-gray-100 shadow-sm rounded-full text-[10px] flex items-center gap-1';
      badge.innerHTML = `<span>${emoji}</span><span class="text-gray-500 font-bold">${users.length}</span>`;
      container.appendChild(badge);
    }
  });
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- AI Logic ---
async function analyzeSentiment(text: string) {
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    const sentiment = data.sentiment || "NEUTRAL";
    
    moodVal.textContent = sentiment;
    const weights: Record<string, number> = { 'AGGRESSIVE': 10, 'MELANCHOLY': 30, 'NEUTRAL': 50, 'ANALYTIC': 75, 'VIBRANT': 100, 'CALM': 85 };
    const width = weights[sentiment] || 50;
    moodBar.style.width = width + '%';

    if (currentUser) {
      await addDoc(collection(db, 'users', currentUser.uid, 'sentiment_history'), {
        sentiment,
        score: width,
        timestamp: serverTimestamp()
      });
    }

    if (sentiment === 'AGGRESSIVE' || sentiment === 'MELANCHOLY') {
      triggerCommunicationCoach(text, sentiment);
    }
  } catch (e) { console.error('AI Sentiment Error:', e); }
}

async function triggerCommunicationCoach(text: string, sentiment: string) {
  try {
    typingStatus.classList.remove('hidden');
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sentiment, surveyData: currentSurveyData })
    });
    const data = await res.json();
    
    if (data.text) {
      const coachEl = createMessageElement("Coach Suggestion: " + data.text, true, "Communication Coach");
      coachEl.querySelector('.ai-bubble')?.classList.add('!bg-orange-50', '!border-orange-200', '!text-orange-900', 'border');
      chatMessages.appendChild(coachEl);
      scrollToBottom();
    }
  } catch(e) {
    console.error('Coach Error', e);
  } finally {
    typingStatus.classList.add('hidden');
  }
}

async function handleInterpretation(text: string) {
  typingStatus.classList.remove('hidden');
  try {
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, surveyData: currentSurveyData })
    });
    const data = await res.json();
    const interpretationText = data.text || "Nexus could not distill intent at this time.";
    
    const interpretEl = createMessageElement(interpretationText, true, "Interpreter");
    interpretEl.querySelector('.ai-bubble')?.classList.add('border-blue-500/10', 'bg-blue-50/30', 'backdrop-blur-2xl', 'shadow-2xl');
    chatMessages.appendChild(interpretEl);
    scrollToBottom();
  } catch (e) {
    console.error('AI Interpretation Error:', e);
  } finally {
    typingStatus.classList.add('hidden');
  }
}

// --- Firebase Sync ---
function setupMessageListener() {
  if (!currentUser) return;
  const q = query(
    collection(db, 'messages'), 
    where('senderId', '==', currentUser.uid),
    orderBy('timestamp', 'asc'), 
    limit(50)
  );
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        let decPromise = Promise.resolve(data.text);
        if (data.text && typeof data.text === 'object' && masterKey) {
           decPromise = NexusVault.decrypt(data.text, masterKey).catch(() => "[Encrypted Data - Master Key Mismatch]");
        } else if (typeof data.text === 'string' && !data.text.startsWith('{')) {
           decPromise = Promise.resolve(data.text);
        }

        decPromise.then((decryptedText: string) => {
          const msgEl = createMessageElement(
            decryptedText, 
            data.isAI, 
            data.senderName, 
            data.flag, 
            data.flagDesc,
            data.isIykyk,
            change.doc.id,
            data.reactions
          );
          msgEl.id = 'msg-' + change.doc.id;
          chatMessages.appendChild(msgEl);
          
          if (data.flag) {
            isLocked = true;
            lockedBadge.classList.remove('hidden');
            unlockUi.classList.remove('hidden');
            currentFlagText.textContent = data.flag.toUpperCase();
            currentFlagDesc.textContent = data.flagDesc ? `[ ${data.flagDesc.toUpperCase()} ]` : "";
            document.querySelector('.glass-panel')?.classList.add('locked-border');
          }
          
          scrollToBottom();
        });
      } else if (change.type === 'modified') {
        const msgEl = document.getElementById('msg-' + change.doc.id);
        if (msgEl) {
          const data = change.doc.data();
          updateReactionsUI(msgEl, data.reactions);
        }
      } else if (change.type === 'removed') {
        const msgEl = document.getElementById('msg-' + change.doc.id);
        if (msgEl) {
          msgEl.remove();
        }
      }
    });
  });
}

// --- Voice Call Logic (PeerJS) ---
async function initPeerJS() {
  if (!currentUser) return;
  
  let iceServers: any[] = [];
  try {
    const res = await fetch('/api/turn', { method: 'POST' });
    const data = await res.json();
    if (data && data.iceServers && data.iceServers.length > 0) {
      iceServers = data.iceServers;
    } else {
      iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  } catch (e) {
    console.error('Failed to get turn servers, using default stun', e);
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  // Use UID as peer ID for easy discovery
  peer = new Peer(currentUser.uid, {
    config: {
      iceServers: iceServers
    }
  });
  
  peer.on('open', (id) => {
    console.log('Peer ID:', id);
    callPeerId.textContent = `P-ID: ${id.slice(0, 8)}`;
    mySynapseId.textContent = id;
  });

  peer.on('call', async (call) => {
    const isVideo = call.metadata?.video;
    if (confirm(`Incoming ${isVideo ? 'video ' : 'voice '}link from synapse ${call.peer.slice(0, 8)}. Accept?`)) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        if (isVideo) {
          const localVideo = document.getElementById('local-video') as HTMLVideoElement;
          localVideo.srcObject = localStream;
          localVideo.classList.remove('hidden');
        }
        call.answer(localStream);
        setupCallHandlers(call, isVideo);
        showCallOverlay('In Stream', call.peer);
      } catch (err) {
        console.error('Media Error:', err);
      }
    } else {
      call.close();
    }
  });
}

function setupCallHandlers(call: MediaConnection, isVideo: boolean = false) {
  currentCall = call;
  call.on('stream', (stream) => {
    if (isVideo) {
      const remoteVideo = document.getElementById('remote-video') as HTMLVideoElement;
      remoteVideo.srcObject = stream;
      remoteVideo.classList.remove('hidden');
    } else {
      remoteAudio.srcObject = stream;
    }
  });
  call.on('close', () => {
    endCall();
  });
  call.on('error', (err) => {
    console.error('Call Error:', err);
    endCall();
  });
}

async function startCall() {
  const targetId = prompt("Enter the Neural Synapse ID to connect (Recipient's UID) for AUDIO:");
  if (!targetId) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    showCallOverlay('Linking Audio...', targetId);
    if (peer) {
      const call = peer.call(targetId, localStream, { metadata: { video: false } });
      setupCallHandlers(call, false);
    }
  } catch (err) {
    alert("Microphone access denied. Nexus link failed.");
  }
}

async function startVideoCall() {
  const targetId = prompt("Enter the Neural Synapse ID to connect (Recipient's UID) for VIDEO:");
  if (!targetId) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localVideo = document.getElementById('local-video') as HTMLVideoElement;
    localVideo.srcObject = localStream;
    localVideo.classList.remove('hidden');

    showCallOverlay('Linking Video...', targetId);
    if (peer) {
      const call = peer.call(targetId, localStream, { metadata: { video: true } });
      setupCallHandlers(call, true);
    }
  } catch (err) {
    alert("Camera/Microphone access denied.");
  }
}

function showCallOverlay(status: string, peerId: string) {
  callOverlay.classList.remove('hidden');
  callStatus.textContent = status;
  callPeerId.textContent = `P-ID: ${peerId.slice(0, 8)}`;
}

function endCall() {
  currentCall?.close();
  localStream?.getTracks().forEach(track => track.stop());
  remoteAudio.srcObject = null;
  
  const remoteVideo = document.getElementById('remote-video') as HTMLVideoElement;
  const localVideo = document.getElementById('local-video') as HTMLVideoElement;
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  remoteVideo.classList.add('hidden');
  localVideo.classList.add('hidden');
  
  callOverlay.classList.add('hidden');
}

// --- Event Listeners ---
authBtn.addEventListener('click', async () => {
  if (currentUser) {
    await auth.signOut();
  } else {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error('Auth Error:', e);
    }
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    authBtn.textContent = 'Nexus Active';
    authBtn.classList.remove('btn-premium');
    authBtn.classList.add('bg-blue-50', 'text-blue-600', 'border', 'border-blue-200');
    voiceCallBtn.classList.remove('hidden');
    videoCallBtn.classList.remove('hidden');
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.placeholder = "Inject thought...";
    initPeerJS();
    
    try {
      await setDoc(doc(db, 'users', user.uid), {
        displayName: user.displayName || 'Anon',
        email: user.email,
        photoURL: user.photoURL,
        lastSeen: serverTimestamp()
      }, { merge: true });
    } catch(err) {
      console.error('Failed to sync user data:', err);
    }

    // Clear initial messages and setup real-sync
    chatMessages.innerHTML = '';
    setupContactsListener();
    loadSurveyData();
    if (masterKey) {
      setupMessageListener();
    }
  } else {
    authBtn.textContent = 'Join Nexus';
    authBtn.classList.add('btn-premium');
    authBtn.classList.remove('bg-blue-50', 'text-blue-600', 'border', 'border-blue-200');
    voiceCallBtn.classList.add('hidden');
    videoCallBtn.classList.add('hidden');
    chatInput.disabled = true;
    sendButton.disabled = true;
    chatInput.placeholder = "Authentication required...";
    chatMessages.innerHTML = '<div class="flex flex-col items-center justify-center h-full opacity-30 text-[10px] font-black uppercase tracking-widest text-gray-500">Sync with Nexus to begin exchange</div>';
    peer?.destroy();
  }
  updateWordCounter();
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !currentUser || (isIykykMode && getWordCount(message) > currentWordLimit)) return;

  const usedFlag = currentFlag;
  const usedDesc = flagDescriptionInput.value.trim();

  // Optimistic cleanup
  chatInput.value = '';
  flagDescriptionInput.value = '';
  chatInput.style.height = 'auto';
  flagPicker.classList.add('hidden');
  
  try {
    const encryptedMessage = masterKey ? await NexusVault.encrypt(message, masterKey) : message;
    await addDoc(collection(db, 'messages'), {
      text: encryptedMessage,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anon',
      timestamp: serverTimestamp(),
      flag: usedFlag,
      flagDesc: usedDesc,
      isAI: false,
      isIykyk: isIykykMode
    });
    
    analyzeSentiment(message);
    
    // Reset flags
    currentFlag = null;
    document.querySelectorAll('.flag-option').forEach(o => o.classList.remove('bg-black', 'text-white'));
  } catch (err) {
    console.error('Firestore Write Error:', err);
  }
});

voiceCallBtn.addEventListener('click', startCall);
videoCallBtn.addEventListener('click', startVideoCall);
endCallBtn.addEventListener('click', endCall);
copyMyIdBtn.addEventListener('click', () => {
  if (currentUser) {
    navigator.clipboard.writeText(currentUser.uid);
    const originalText = mySynapseId.textContent;
    mySynapseId.textContent = "COPIED";
    setTimeout(() => { mySynapseId.textContent = originalText; }, 1000);
  }
});

// --- View Navigation ---
function switchView(viewName: keyof typeof views) {
  // Hide all views with transition
  Object.values(views).forEach(v => {
    v.classList.add('fade-out');
    setTimeout(() => v.classList.add('hidden'), 400);
  });

  // Remove active state from nav buttons
  Object.values(navBtns).forEach(b => b.classList.remove('active', 'text-white'));
  Object.values(navBtns).forEach(b => b.classList.add('text-gray-500'));

  // Show selected view
  setTimeout(() => {
    views[viewName].classList.remove('hidden');
    // slight delay to ensure display:block applies before removing fade-out for transition
    setTimeout(() => {
      views[viewName].classList.remove('fade-out');
    }, 50);
  }, 400);

  // Set active state
  navBtns[viewName].classList.add('active', 'text-white');
  navBtns[viewName].classList.remove('text-gray-500');
}

navBtns.home.addEventListener('click', () => switchView('home'));
navBtns.contacts.addEventListener('click', () => switchView('contacts'));
navBtns.chat.addEventListener('click', () => switchView('chat'));
let sentimentChart: Chart | null = null;

async function updateSentimentChart() {
  if (!currentUser) return;
  const canvas = document.getElementById('sentiment-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const q = query(
    collection(db, 'users', currentUser.uid, 'sentiment_history'),
    orderBy('timestamp', 'asc'),
    limit(50)
  );

  const snapshot = await getDocs(q);
  const labels: string[] = [];
  const dataPoints: number[] = [];
  const pointColors: string[] = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.timestamp) {
      const date = data.timestamp.toDate();
      labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } else {
      labels.push('');
    }
    dataPoints.push(data.score || 50);
    
    // Color mapping
    let color = '#3b82f6'; // NEUTRAL (blue)
    if (data.sentiment === 'AGGRESSIVE') color = '#ef4444'; // red
    else if (data.sentiment === 'MELANCHOLY') color = '#f97316'; // orange
    else if (data.sentiment === 'CALM') color = '#10b981'; // green
    else if (data.sentiment === 'VIBRANT') color = '#a855f7'; // purple
    else if (data.sentiment === 'ANALYTIC') color = '#eab308'; // yellow
    pointColors.push(color);
  });

  if (sentimentChart) {
    sentimentChart.destroy();
  }

  sentimentChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Emotional Score',
        data: dataPoints,
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 2,
        pointBackgroundColor: pointColors,
        pointBorderColor: 'transparent',
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { 
          display: false,
          min: 0,
          max: 100
        },
        x: {
          grid: { display: false, color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
        }
      }
    }
  });
}

navBtns.advancement.addEventListener('click', () => {
  switchView('advancement');
  updateSentimentChart();
});
navBtns.calendar.addEventListener('click', () => switchView('calendar'));
navBtns.survey.addEventListener('click', () => switchView('survey'));

// Make global functions available to inline onclick
(window as any).switchView = switchView;

// UI controls
modeFree.addEventListener('click', () => {
  isIykykMode = false;
  document.body.classList.remove('mode-iykyk-active');
  modeFree.classList.add('bg-white', 'shadow-lg', 'text-gray-900', 'border-gray-100');
  modeFree.classList.remove('text-gray-400');
  modeIykyk.classList.remove('bg-white', 'shadow-lg', 'text-gray-900', 'border-gray-100');
  modeIykyk.classList.add('text-gray-400');
  useExtensionBtn.classList.add('hidden');
  updateWordCounter();
});

modeIykyk.addEventListener('click', () => {
  isIykykMode = true;
  document.body.classList.add('mode-iykyk-active');
  modeIykyk.classList.add('bg-white', 'shadow-lg', 'text-gray-900', 'border-gray-100');
  modeIykyk.classList.remove('text-gray-400');
  modeFree.classList.remove('bg-white', 'shadow-lg', 'text-gray-900', 'border-gray-100');
  modeFree.classList.add('text-gray-400');
  useExtensionBtn.classList.remove('hidden');
  updateWordCounter();
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
  updateWordCounter();
});

toggleFlagBtn.addEventListener('click', () => {
  flagPicker.classList.toggle('hidden');
});

document.querySelectorAll('.flag-option').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    currentFlag = target.dataset.flag || null;
    document.querySelectorAll('.flag-option').forEach(o => o.classList.remove('bg-black', 'text-white'));
    target.classList.add('bg-black', 'text-white');
  });
});

resolveBtn.addEventListener('click', () => {
  isLocked = false;
  lockedBadge.classList.add('hidden');
  unlockUi.classList.add('hidden');
  document.querySelector('.glass-panel')?.classList.remove('locked-border');
});

async function loadSurveyData() {
  if (!currentUser) return;
  const q = query(
    collection(db, 'nexus_surveys', currentUser.uid, 'sessions'),
    orderBy('timestamp', 'desc'),
    limit(1)
  );
  onSnapshot(q, async (snapshot) => {
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      if (data.survey_data) {
        let dec = data.survey_data;
        if (data.survey_data && typeof data.survey_data === 'object' && masterKey) {
           try { dec = await NexusVault.decrypt(data.survey_data, masterKey); } catch(e){}
        }
        if (typeof dec === 'string') {
           try {
             currentSurveyData = JSON.parse(dec);
           } catch(e) {}
        }
      }
    }
  });
}

function setupContactsListener() {
  const contactsList = document.getElementById('contacts-list') as HTMLElement;
  const favoritesList = document.getElementById('favorites-list') as HTMLElement;
  const homeFavoritesList = document.getElementById('home-favorites-list') as HTMLElement;
  
  if (!contactsList || !currentUser) return;

  const q = query(collection(db, 'users', currentUser.uid, 'contacts'), orderBy('name', 'asc'));
  onSnapshot(q, (snapshot) => {
    // Keep headers
    contactsList.innerHTML = `<h2 class="col-span-full text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 border-b border-gray-100 pb-2">All Links</h2>`;
    favoritesList.innerHTML = `<h2 class="col-span-full text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2 border-b border-blue-100 pb-2">Favorite Links</h2>`;
    homeFavoritesList.innerHTML = '';
    
    let hasFavorites = false;
    let hasContacts = false;

    if (snapshot.empty) {
      contactsList.innerHTML += `<div class="flex items-center justify-center p-12 text-xs font-bold text-gray-400 uppercase tracking-widest italic col-span-full border-2 border-dashed border-gray-200 rounded-2xl">No saved contacts. Add a link above.</div>`;
      homeFavoritesList.innerHTML = `<div class="text-[10px] uppercase font-bold text-gray-600 italic">No favorites starred.</div>`;
      favoritesList.classList.add('hidden');
      return;
    }

    snapshot.forEach(docSnap => {
      hasContacts = true;
      const contact = docSnap.data();
      const contactId = docSnap.id;
      
      const isFav = contact.isFavorite || false;
      const synapseId = contact.synapseId || '';
      const avatarUrl = synapseId ? 'https://api.dicebear.com/7.x/identicon/svg?seed=' + synapseId : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(contact.name);
      
      const cardHtml = `
        <div class="contact-card relative overflow-hidden group/card bg-white rounded-3xl border border-gray-200 hover:border-blue-300 hover:shadow-2xl transition-all duration-300 flex flex-col justify-between">
          <div class="h-20 w-full bg-gradient-to-r from-blue-100 to-purple-100"></div>
          
          <div class="absolute top-4 left-4 flex gap-2 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity">
            <button onclick="openChatWith('${contactId}')" class="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-blue-600 flex items-center justify-center shadow-lg backdrop-blur" title="Message">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            </button>
            <button onclick="viewProfile('${contactId}')" class="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-600 flex items-center justify-center shadow-lg backdrop-blur" title="View Profile">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><circle cx="12" cy="10" r="3"/></svg>
            </button>
            ${synapseId ? `
            <button onclick="startSpecificCall('${synapseId}', false)" class="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-blue-600 flex items-center justify-center shadow-lg backdrop-blur" title="Quick Audio Call">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </button>
            <button onclick="startSpecificCall('${synapseId}', true)" class="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-blue-600 flex items-center justify-center shadow-lg backdrop-blur" title="Quick Video Call">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            </button>
            ` : `
            <button onclick="syncContact('${contactId}', '${contact.mobileNumber}')" class="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-purple-600 flex items-center justify-center shadow-lg backdrop-blur" title="Sync Contact">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            </button>
            `}
          </div>

          <button onclick="toggleFavorite('${contactId}', ${isFav})" class="absolute top-4 right-4 text-${isFav ? 'yellow-500' : 'white hover:scale-110 drop-shadow-md'} transition-all z-10 p-1">
             <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </button>

          <div class="px-6 pb-6 relative flex flex-col items-center">
            <img src="${avatarUrl}" alt="Avatar" class="w-20 h-20 rounded-full bg-white object-cover border-4 border-white shadow-lg -mt-10 mb-4 z-10">
            <h4 class="font-black text-gray-900 text-lg truncate w-full text-center">${contact.name}</h4>
            <p class="text-[10px] uppercase font-bold tracking-widest text-gray-400 mt-1 mb-2">${contact.mobileNumber || 'No Mobile'}</p>
            
            ${synapseId ? `<span class="inline-block px-3 py-1 rounded-full text-[9px] font-black tracking-widest uppercase bg-green-50 text-green-600 border border-green-100 mb-6 shadow-sm">Sync Active</span>` : `<span class="inline-block px-3 py-1 rounded-full text-[9px] font-black tracking-widest uppercase bg-gray-50 text-gray-400 border border-gray-100 mb-6 shadow-sm">Offline</span>`}
            
            <div class="flex justify-center gap-2 w-full">
              ${synapseId ? `<button onclick="startSpecificCall('${synapseId}', false)" class="flex-1 py-3 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest bg-gray-50 text-gray-700 border border-gray-200 hover:bg-black hover:text-white hover:border-black transition-all shadow-sm">Audio</button>` : `<button disabled class="flex-1 py-3 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed">Audio</button>`}
              
              ${synapseId ? `<button onclick="startSpecificCall('${synapseId}', true)" class="flex-1 py-3 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white border border-blue-600 hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all">Video</button>` : ''}
            </div>
          </div>
        </div>
      `;

      if (isFav) {
        hasFavorites = true;
        favoritesList.insertAdjacentHTML('beforeend', cardHtml);
        
        // Add to home favorites list
        homeFavoritesList.insertAdjacentHTML('beforeend', `
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
             <div class="flex items-center gap-3">
               <img src="${avatarUrl}" class="w-8 h-8 rounded-full border border-white/20">
               <div>
                  <div class="text-xs font-bold text-white">${contact.name}</div>
                  <div class="text-[9px] uppercase tracking-widest font-black text-gray-400">${synapseId ? 'Active Link' : 'Offline'}</div>
               </div>
             </div>
             ${synapseId ? `<button onclick="startSpecificCall('${synapseId}', false); event.stopPropagation();" class="w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></button>` : ''}
          </div>
        `);
      } else {
        contactsList.insertAdjacentHTML('beforeend', cardHtml);
      }
    });
    
    if (hasFavorites) {
      favoritesList.classList.remove('hidden');
    } else {
      favoritesList.classList.add('hidden');
      homeFavoritesList.innerHTML = `<div class="text-[10px] uppercase font-bold text-gray-600 italic">No favorites starred.</div>`;
    }
    
  }, (err) => {
    console.error('Failed to load contacts:', err);
  });
}

(window as any).toggleFavorite = async (contactId: string, currentStatus: boolean) => {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'contacts', contactId), {
      isFavorite: !currentStatus
    }, { merge: true });
  } catch (err) {
    console.error('Failed to toggle fav:', err);
  }
};

// Contact Modal Handling
const addContactBtn = document.getElementById('add-contact-btn') as HTMLButtonElement;
const addContactModal = document.getElementById('add-contact-modal') as HTMLElement;
const closeContactModal = document.getElementById('close-contact-modal') as HTMLButtonElement;
const addContactForm = document.getElementById('add-contact-form') as HTMLFormElement;
const surveyForm = document.getElementById('survey-form') as HTMLFormElement;
surveyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const goal = (document.getElementById('survey-goal') as HTMLInputElement).value;
  const stressor = (document.getElementById('survey-stressor') as HTMLTextAreaElement).value;

  currentSurveyData = { goal, stressor };

  // Save encrypted to Firebase
  const plainData = JSON.stringify(currentSurveyData);
  const encrypted = masterKey ? await NexusVault.encrypt(plainData, masterKey) : plainData;

  try {
    await addDoc(collection(db, 'nexus_surveys', currentUser.uid, 'sessions'), {
      timestamp: serverTimestamp(),
      survey_data: encrypted
    });
    alert('Nexus Personalization Updated.');
    (window as any).switchView('home');
  } catch (err) {
    console.error('Failed to save survey', err);
    alert('Failed to save survey');
  }
});

addContactBtn.addEventListener('click', () => {
  addContactModal.classList.remove('hidden');
});
closeContactModal.addEventListener('click', () => {
  addContactModal.classList.add('hidden');
});

addContactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  
  const name = (document.getElementById('contact-name') as HTMLInputElement).value;
  const mobileNumber = (document.getElementById('contact-mobile') as HTMLInputElement).value;
  const email = (document.getElementById('contact-email') as HTMLInputElement).value;
  const company = (document.getElementById('contact-company') as HTMLInputElement).value;
  const role = (document.getElementById('contact-role') as HTMLInputElement).value;
  const notes = (document.getElementById('contact-notes') as HTMLTextAreaElement).value;
  const synapseId = (document.getElementById('contact-synapse') as HTMLInputElement).value;
  const isFavorite = (document.getElementById('contact-favorite') as HTMLInputElement).checked;
  
  try {
    const contactRef = doc(collection(db, 'users', currentUser.uid, 'contacts'));
    await setDoc(contactRef, {
      name,
      mobileNumber,
      email,
      company,
      role,
      notes,
      synapseId,
      isFavorite,
      createdAt: serverTimestamp()
    });
    
    addContactModal.classList.add('hidden');
    addContactForm.reset();
  } catch (err) {
    console.error('Failed to save contact:', err);
    alert('Failed to save contact. Please try again.');
  }
});

(window as any).startSpecificCall = async (targetId: string, isVideo: boolean) => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    
    if (isVideo) {
      const localVideo = document.getElementById('local-video') as HTMLVideoElement;
      localVideo.srcObject = localStream;
      localVideo.classList.remove('hidden');
    }

    showCallOverlay(isVideo ? 'Linking Video...' : 'Linking Audio...', targetId);
    
    if (peer) {
      const call = peer.call(targetId, localStream, { metadata: { video: isVideo } });
      setupCallHandlers(call, isVideo);
    }
  } catch (err) {
    alert("Media access denied. Link failed.");
    console.error(err);
  }
};

(window as any).openChatWith = (contactId: string) => {
  (window as any).currentChatId = contactId;
  (window as any).switchView('chat');
};

(window as any).viewProfile = async (contactId: string) => {
  if (!currentUser) return;
  try {
    const docRef = doc(db, 'users', currentUser.uid, 'contacts', contactId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const contact = snap.data();
      const synapseId = contact.synapseId || '';
      const avatarUrl = synapseId ? 'https://api.dicebear.com/7.x/identicon/svg?seed=' + synapseId : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(contact.name);
      
      const setEl = (id: string, text: string) => {
         const el = document.getElementById(id);
         if (el) el.textContent = text || 'N/A';
      };

      (document.getElementById('profile-modal-avatar') as HTMLImageElement).src = avatarUrl;
      setEl('profile-modal-name', contact.name);
      
      const roleCompany = [contact.role, contact.company].filter(Boolean).join(' @ ');
      setEl('profile-modal-role-company', roleCompany || 'No specified role');
      
      setEl('profile-modal-mobile', contact.mobileNumber);
      setEl('profile-modal-email', contact.email);
      setEl('profile-modal-synapse', contact.synapseId || 'Offline');
      setEl('profile-modal-notes', contact.notes || 'No agent notes recorded.');

      document.getElementById('view-profile-modal')?.classList.remove('hidden');
    }
  } catch (e) {
    console.error('Failed to load profile', e);
  }
};

(window as any).syncContact = async (contactId: string, mobile: string) => {
  if (!currentUser) return;
  if (!mobile) {
    alert('Cannot sync without a verified mobile trace.');
    return;
  }
  
  try {
    const fakeSynapseId = Math.random().toString(36).substring(2, 10).toUpperCase() + "-SYNC";
    await updateDoc(doc(db, 'users', currentUser.uid, 'contacts', contactId), {
      synapseId: fakeSynapseId
    });
    alert('Synapse Successfully Bound: ' + fakeSynapseId + '\\nContact is now actively linked.');
  } catch (err) {
    console.error(err);
    alert('Failed to execute sync operation on Neural Hub.');
  }
};

// Sidebar dynamic content
const agendaTopics = [
  "Cognitive Sync: Aligning shared values for the current cycle.",
  "Emotional Response Tuning: Minimizing reactive friction.",
  "Goal Synthesis: Merging professional trajectories."
];
agendaTopics.forEach(topic => {
  const item = document.createElement('div');
  item.className = 'assistant-card p-4 text-[10px] font-black uppercase tracking-[0.1em] leading-relaxed border-l-4 border-l-black';
  item.textContent = topic;
  counselingAgenda.appendChild(item);
});
