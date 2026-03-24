import socketio

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
)


def asgi_mount(fastapi_app):
    """Wrap FastAPI so Socket.IO handles /socket.io and the rest falls through."""
    return socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
