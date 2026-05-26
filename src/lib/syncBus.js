import { supabase } from './supabase';

let _channel = null;
let _subscribed = false;
const _handlers = {};

function ensureChannel() {
  if (_channel) return _channel;
  _channel = supabase
    // `broadcast.self: false` evita que esta misma pestana reciba sus
    // propios broadcasts (antes el save propio rebotaba y disparaba un
    // reload innecesario; tambien causaba ecos cruzados entre providers).
    .channel('kamak-data-sync', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'changed' }, ({ payload }) => {
      const key = payload?.key;
      if (key && _handlers[key]) _handlers[key].forEach(fn => fn());
    })
    .subscribe((status) => {
      _subscribed = status === 'SUBSCRIBED';
    });
  return _channel;
}

export function broadcastChange(key) {
  const ch = ensureChannel();
  if (_subscribed) ch.send({ type: 'broadcast', event: 'changed', payload: { key } });
}

export function onRemoteChange(key, fn) {
  ensureChannel();
  if (!_handlers[key]) _handlers[key] = [];
  _handlers[key].push(fn);
  return () => {
    if (_handlers[key]) _handlers[key] = _handlers[key].filter(f => f !== fn);
  };
}
