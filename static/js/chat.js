const socket = io();
const messages = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');
const userCount = document.getElementById('user-count');
const dropZone = document.getElementById('drop-zone');

// 图片压缩配置
const IMAGE_MAX_SIZE = 800; // 图片最大尺寸
const IMAGE_QUALITY = 0.6; // 图片质量

// 文件处理函数
async function handleFile(file) {
    if (file.type.startsWith('image/')) {
        try {
            const compressedImage = await compressImage(file);
            const fileData = {
                filename: file.name,
                data: compressedImage,
                type: 'image'
            };
            socket.emit('file', fileData);
        } catch (error) {
            console.error('Error compressing image:', error);
            alert('图片处理失败，请重试');
        }
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = {
                filename: file.name,
                data: e.target.result,
                type: 'file'
            };
            socket.emit('file', fileData);
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
                
                // 转换为base64
                const compressedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
                resolve(compressedDataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 文件拖放处理
let dragCounter = 0;
let isProcessingFile = false;  // 添加文件处理状态标志

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

    if (isProcessingFile) return;  // 如果正在处理文件，则忽略新的拖放
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        isProcessingFile = true;
        try {
            await handleFile(files[0]);
        } finally {
            isProcessingFile = false;
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