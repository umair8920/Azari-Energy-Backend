from websocket.sio import sio


@sio.event
async def connect(sid, _environ):
    return True


@sio.on("subscribe_job")
async def subscribe_job(sid, data):
    if not isinstance(data, dict):
        return
    job_id = data.get("job_id")
    if job_id and isinstance(job_id, str):
        await sio.enter_room(sid, job_id)
