const socket = io();
const messages = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');
const userCount = document.getElementById('user-count');
const dropZone = document.getElementById('drop-zone');

// 图片压缩配置
const IMAGE_MAX_SIZE = 1200; // 增加最大尺寸
const IMAGE_QUALITY = 0.5; // 降低默认质量
const CHUNK_SIZE = 1024 * 1024; // 增加到1MB
const MAX_PARALLEL_CHUNKS = 5; // 最大并行传输数

// 创建进度条元素
function createProgressBar(filename) {
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = '0%';
    
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.textContent = `${filename} (0%)`;
    
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);
    return { progressContainer, progressBar, progressText };
}

// 格式化文件大小
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// 格式化速度
function formatSpeed(bytesPerSecond) {
    return formatSize(bytesPerSecond) + '/s';
}

// 更新进度显示
function updateProgress(progressElements, progress, speed = null) {
    const { progressBar, progressText } = progressElements;
    progressBar.style.width = `${progress}%`;
    let text = `传输中... ${Math.round(progress)}%`;
    if (speed !== null) {
        text += ` (${formatSpeed(speed)})`;
    }
    progressText.textContent = text;
}

// 自适应压缩质量
function getAdaptiveQuality(fileSize) {
    if (fileSize > 5 * 1024 * 1024) return 0.3;      // 5MB以上
    if (fileSize > 2 * 1024 * 1024) return 0.4;      // 2MB-5MB
    if (fileSize > 1 * 1024 * 1024) return 0.5;      // 1MB-2MB
    if (fileSize > 500 * 1024) return 0.6;           // 500KB-1MB
    return 0.7;                                       // 500KB以下
}

// 压缩图片函数
async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // 调整图片尺寸
                if (width > height && width > IMAGE_MAX_SIZE) {
                    height = (IMAGE_MAX_SIZE * height) / width;
                    width = IMAGE_MAX_SIZE;
                } else if (height > IMAGE_MAX_SIZE) {
                    width = (IMAGE_MAX_SIZE * width) / height;
                    height = IMAGE_MAX_SIZE;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 使用自适应质量
                const quality = getAdaptiveQuality(file.size);
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 分片传输函数
async function sendFileInChunks(fileData, progressElements, startProgress = 0) {
    const data = fileData.data;
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
    let currentChunk = 0;
    let startTime = Date.now();
    let lastUpdate = startTime;
    let bytesTransferred = 0;
    let activeTransfers = 0;
    let completedChunks = new Set();

    // 创建进度更新函数
    const updateTransferProgress = () => {
        const currentTime = Date.now();
        const timeDiff = currentTime - lastUpdate;
        if (timeDiff >= 200) { // 更频繁地更新进度
            const speed = (bytesTransferred * 1000) / timeDiff;
            const progress = startProgress + ((completedChunks.size / totalChunks) * (100 - startProgress));
            updateProgress(progressElements, progress, speed);
            lastUpdate = currentTime;
            bytesTransferred = 0;
        }
    };

    // 发送单个分片
    const sendChunk = async (chunkNum) => {
        if (completedChunks.has(chunkNum)) return;
        
        const start = chunkNum * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, data.length);
        const chunk = data.slice(start, end);
        
        const chunkData = {
            ...fileData,
            data: chunk,
            chunk: chunkNum,
            totalChunks: totalChunks
        };

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
                socket.emit('file_chunk', chunkData, () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            
            bytesTransferred += chunk.length;
            completedChunks.add(chunkNum);
            updateTransferProgress();
        } catch (error) {
            console.error(`Chunk ${chunkNum} failed:`, error);
            return false;
        }
        return true;
    };

    // 并行发送分片
    while (currentChunk < totalChunks) {
        const chunkPromises = [];
        
        while (activeTransfers < MAX_PARALLEL_CHUNKS && currentChunk < totalChunks) {
            chunkPromises.push(sendChunk(currentChunk));
            activeTransfers++;
            currentChunk++;
        }

        const results = await Promise.all(chunkPromises);
        activeTransfers -= results.length;

        // 重试失败的分片
        const failedChunks = results.map((success, index) => 
            !success ? currentChunk - results.length + index : null
        ).filter(chunk => chunk !== null);

        for (const failedChunk of failedChunks) {
            let retries = 3;
            while (retries > 0 && !completedChunks.has(failedChunk)) {
                await sendChunk(failedChunk);
                retries--;
            }
        }
    }

    // 显示最终平均速度
    const totalTime = (Date.now() - startTime) / 1000;
    const averageSpeed = data.length / totalTime;
    updateProgress(progressElements, 100, averageSpeed);
}

// 文件处理函数
async function handleFile(file) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const userSpan = document.createElement('span');
    userSpan.className = 'user-name';
    userSpan.textContent = '我';
    messageDiv.appendChild(userSpan);
    
    const progressElements = createProgressBar(file.name + ` (${formatSize(file.size)})`);
    messageDiv.appendChild(progressElements.progressContainer);
    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;

    if (file.type.startsWith('image/')) {
        try {
            updateProgress(progressElements, 0);
            const compressedImage = await compressImage(file);
            const fileData = {
                filename: file.name,
                data: compressedImage,
                type: 'image'
            };
            await sendFileInChunks(fileData, progressElements, 30);
            messageDiv.removeChild(progressElements.progressContainer);
        } catch (error) {
            console.error('Error processing image:', error);
            progressElements.progressText.textContent = '传输失败';
            progressElements.progressText.style.color = '#dc3545';
            alert('图片处理失败，请重试');
        }
    } else {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const fileData = {
                filename: file.name,
                data: e.target.result,
                type: file.type.startsWith('video/') ? 'video' : 'file'
            };
            await sendFileInChunks(fileData, progressElements, 0);
            messageDiv.removeChild(progressElements.progressContainer);
        };
        
        reader.onprogress = (event) => {
            if (event.lengthComputable) {
                const progress = (event.loaded / event.total) * 30;
                updateProgress(progressElements, progress);
            }
        };
        
        reader.readAsDataURL(file);
    }
}

// Socket.io 事件处理
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('update_users', (count) => {
    userCount.textContent = count;
});

socket.on('message', (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const userSpan = document.createElement('span');
    userSpan.className = 'user-name';
    userSpan.textContent = `${data.user} ${data.time}`;
    messageDiv.appendChild(userSpan);

    if (data.type === 'text') {
        const messageContent = document.createElement('span');
        messageContent.className = 'message-content';
        messageContent.textContent = data.message;
        messageDiv.appendChild(messageContent);
    } else if (data.type === 'image') {
        const imgContainer = document.createElement('div');
        imgContainer.className = 'image-container';
        
        const img = document.createElement('img');
        img.src = data.data;
        img.className = 'message-image';
        img.onclick = () => window.open(img.src);
        
        // 添加加载动画
        img.style.display = 'none';
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.textContent = '图片加载中...';
        
        imgContainer.appendChild(loading);
        imgContainer.appendChild(img);
        messageDiv.appendChild(imgContainer);
        
        // 图片加载完成后显示
        img.onload = () => {
            loading.style.display = 'none';
            img.style.display = 'block';
        };
    } else if (data.type === 'file') {
        const link = document.createElement('a');
        link.href = data.data;
        link.download = data.filename;
        link.className = 'file-link';
        link.innerHTML = `📄 ${data.filename}`;
        messageDiv.appendChild(link);
    }
    
    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
});

// 发送消息函数
function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('message', message);
        messageInput.value = '';
    }
}

// 文件拖放处理
let dragCounter = 0;
let isProcessingFile = false;
let lastProcessedFile = null;  // 添加文件处理记录

function handleDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) {
        dropZone.classList.add('active');
    }
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
        dropZone.classList.remove('active');
    }
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
}

async function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter = 0;
    dropZone.classList.remove('active');

    if (isProcessingFile) return;

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        // 检查是否是同一个文件
        if (lastProcessedFile && 
            lastProcessedFile.name === file.name && 
            lastProcessedFile.size === file.size &&
            lastProcessedFile.lastModified === file.lastModified) {
            return;
        }

        isProcessingFile = true;
        lastProcessedFile = file;  // 记录当前处理的文件
        
        try {
            await handleFile(file);
        } finally {
            isProcessingFile = false;
            // 1秒后清除文件记录，允许重复发送相同文件
            setTimeout(() => {
                lastProcessedFile = null;
            }, 1000);
        }
    }
}

// 事件监听器
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && !isProcessingFile) {
        isProcessingFile = true;
        try {
            await handleFile(file);
        } finally {
            isProcessingFile = false;
            fileInput.value = '';
        }
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

messages.addEventListener('dragenter', handleDragEnter);
messages.addEventListener('dragleave', handleDragLeave);
messages.addEventListener('dragover', handleDragOver);
messages.addEventListener('drop', handleDrop); 