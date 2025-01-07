from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 限制文件大小为16MB
socketio = SocketIO(app)

connected_users = {}

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

@socketio.on('file')
def handle_file(data):
    user_ip = connected_users.get(request.sid, 'Unknown')
    file_data = {
        'user': user_ip,
        'filename': data['filename'],
        'data': data['data'],
        'type': data['type'],
        'time': datetime.now().strftime('%H:%M:%S')
    }
    emit('message', file_data, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 