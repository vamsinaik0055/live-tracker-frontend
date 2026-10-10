
import { useEffect, useRef, useState } from 'react'
import { Client } from '@stomp/stompjs'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

function MapUpdater({ position }) {
  const map = useMap()

  useEffect(() => {
    map.setView(position, map.getZoom())
  }, [map, position])

  return null
}

function App() {
  const [sessionCode, setSessionCode] = useState('')
  const [status, setStatus] = useState('Ready')
  const [myPosition, setMyPosition] = useState(null)
  const [sharedPosition, setSharedPosition] = useState(null)
  const [isSharing, setIsSharing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const clientRef = useRef(null)
  const watchIdRef = useRef(null)
  const latestLocationRef = useRef(null)

  function createSession() {
    if (isSharing) {
      setStatus('Stop the current sharing session before creating another.')
      return
    }

    const code = crypto.randomUUID()
    setSessionCode(code)
    setSharedPosition(null)
    setStatus('Session created. Start sharing when you are ready.')
  }

  function connectToSession(code, onConnected) {
    if (clientRef.current) {
      clientRef.current.deactivate()
      clientRef.current = null
    }

    setIsConnected(false)

    const client = new Client({
      brokerURL:
  import.meta.env.VITE_WS_URL ||
  'wss://live-tracker-backend-1.onrender.com/ws',
      reconnectDelay: 3000,

      onConnect: () => {
        setIsConnected(true)
        setStatus(`Connected to session ${code}`)

        client.subscribe(`/topic/location/${code}`, (message) => {
          try {
            const location = JSON.parse(message.body)

            setSharedPosition([
              location.latitude,
              location.longitude
            ])
          } catch {
            setStatus('Received an invalid location message.')
          }
        })

        if (onConnected) {
          onConnected(client)
        }
      },

      onStompError: () => {
        setStatus('WebSocket error. Check your backend.')
      },

      onWebSocketError: () => {
        
setStatus('Cannot connect to the WebSocket backend. Check the URL and backend status.')
      },

      onWebSocketClose: () => {
        setIsConnected(false)
      }
    })

    clientRef.current = client
    client.activate()
  }

  function startSharing() {
    if (!sessionCode.trim()) {
      setStatus('Create a session first.')
      return
    }

    if (!navigator.geolocation) {
      setStatus('Your browser does not support geolocation.')
      return
    }

    if (isSharing) {
      setStatus('Location sharing is already active.')
      return
    }

    setStatus('Requesting location permission...')

    navigator.geolocation.getCurrentPosition(
      (result) => {
        const location = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          timestamp: Date.now()
        }

        latestLocationRef.current = location
        setMyPosition([
          location.latitude,
          location.longitude
        ])

        setIsSharing(true)
        setStatus('Location permission granted. Connecting...')

        connectToSession(sessionCode.trim(), (client) => {
          if (latestLocationRef.current) {
            client.publish({
              destination: `/app/location/${sessionCode.trim()}`,
              body: JSON.stringify(latestLocationRef.current)
            })
          }
        })

        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const update = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              timestamp: Date.now()
            }

            latestLocationRef.current = update

            setMyPosition([
              update.latitude,
              update.longitude
            ])

            const client = clientRef.current

            if (client?.connected) {
              client.publish({
                destination: `/app/location/${sessionCode.trim()}`,
                body: JSON.stringify(update)
              })
            }

            setStatus('Sharing your location. Select Stop Sharing to end.')
          },
          (error) => {
            setStatus(`Location error: ${error.message}`)
          },
          {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 15000
          }
        )
      },
      (error) => {
        setStatus(`Location permission/error: ${error.message}`)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    )
  }

  function joinSession() {
    const code = sessionCode.trim()

    if (!code) {
      setStatus('Enter the session code first.')
      return
    }

    if (isSharing) {
      setStatus('Stop your current sharing session before joining another.')
      return
    }

    setSharedPosition(null)
    setStatus('Connecting to the session...')

    connectToSession(code)
  }

  function stopSharing() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    latestLocationRef.current = null
    setIsSharing(false)

    if (clientRef.current) {
      clientRef.current.deactivate()
      clientRef.current = null
    }

    setIsConnected(false)
    setStatus('Sharing stopped. You are disconnected.')
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }

      if (clientRef.current) {
        clientRef.current.deactivate()
      }
    }
  }, [])

  const mapCenter =
    sharedPosition || myPosition || [13.0827, 80.2707]

  return (
    <main className="container">
      <h1>Live Location Tracker</h1>
      <p>Share your location only with people you trust.</p>

      <section className="panel">
        <h2>Share My Location</h2>

        <button onClick={createSession} disabled={isSharing}>
          Create Session
        </button>

        {sessionCode && (
          <p className="code">
            Session code: <strong>{sessionCode}</strong>
            <button
              onClick={() => navigator.clipboard.writeText(sessionCode)}
            >
              Copy Code
            </button>
          </p>
        )}

        <button onClick={startSharing} disabled={isSharing || !sessionCode}>
          Start Sharing My Location
        </button>

        {isSharing && (
          <button onClick={stopSharing}>
            Stop Sharing
          </button>
        )}
      </section>

      <section className="panel">
        <h2>View Shared Location</h2>

        <input
          value={sessionCode}
          onChange={(event) => setSessionCode(event.target.value)}
          placeholder="Enter session code"
          disabled={isSharing}
        />

        <button onClick={joinSession} disabled={isSharing}>
          Join Session
        </button>
      </section>

      <section className="panel">
        <h2>Status</h2>
        <p>{status}</p>
        <p>WebSocket: {isConnected ? 'Connected' : 'Disconnected'}</p>

        <MapContainer
          center={mapCenter}
          zoom={13}
          style={{ height: '350px', width: '100%' }}
        >
          <MapUpdater position={mapCenter} />

          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {myPosition && (
            <Marker position={myPosition}>
              <Popup>My current location</Popup>
            </Marker>
          )}

          {sharedPosition && (
            <Marker position={sharedPosition}>
              <Popup>Received shared location</Popup>
            </Marker>
          )}
        </MapContainer>
      </section>
    </main>
  )
}

export default App
