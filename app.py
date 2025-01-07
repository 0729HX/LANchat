from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 限制文件大小为16MB
socketio = SocketIO(app)

connected_users = {}
file_chunks = {}  # 存储文件分片

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    user_ip = request.remote_addr
    connected_users[request.sid] = user_ip
    emit('update_users', len(connected_users), broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in connected_users:
        del connected_users[request.sid]
        # 清理未完成的文件分片
        if request.sid in file_chunks:
            del file_chunks[request.sid]
        emit('update_users', len(connected_users), broadcast=True)

@socketio.on('message')
def handle_message(data):
    user_ip = connected_users.get(request.sid, 'Unknown')
    message_data = {
        'user': user_ip,
        'message': data,
        'type': 'text',
        'time': datetime.now().strftime('%H:%M:%S')
    }
    emit('message', message_data, broadcast=True)

@socketio.on('file_chunk')
def handle_file_chunk(data):
    user_ip = connected_users.get(request.sid, 'Unknown')
    chunk_num = data.get('chunk', 0)
    total_chunks = data.get('totalChunks', 1)
    
    # 初始化文件分片存储
    if chunk_num == 0:
        file_chunks[request.sid] = {
            'filename': data['filename'],
            'type': data['type'],
            'chunks': [''] * total_chunks,
            'received_chunks': 0
        }
    
    # 存储分片
    file_info = file_chunks[request.sid]
    file_info['chunks'][chunk_num] = data['data']
    file_info['received_chunks'] += 1
    
    # 检查是否接收完所有分片
    if file_info['received_chunks'] == total_chunks:
        # 合并所有分片
        complete_data = ''.join(file_info['chunks'])
        
        # 发送完整文件
        complete_file_data = {
            'user': user_ip,
            'filename': file_info['filename'],
            'data': complete_data,
            'type': file_info['type'],
            'time': datetime.now().strftime('%H:%M:%S')
        }
        emit('message', complete_file_data, broadcast=True)
        
        # 清理分片数据
        del file_chunks[request.sid]

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 