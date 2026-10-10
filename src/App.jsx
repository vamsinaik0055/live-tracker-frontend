
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const API_URL = "https://live-tracker-backend-1.onrender.com";
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  "wss://live-tracker-backend-1.onrender.com/ws";

function MapUpdater({ location }) {
  const map = useMap();

  useEffect(() => {
    if (location) {
      map.setView([location.latitude, location.longitude], 16);
    }
  }, [location, map]);

  return null;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);

  const [sessionId, setSessionId] = useState(
    () => params.get("session") || ""
  );
  const [token, setToken] = useState(
    () => params.get("token") || ""
  );
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState(
    "Create a session or open a shared link."
  );
  const [sharing, setSharing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [creating, setCreating] = useState(false);

  const clientRef = useRef(null);
  const watchRef = useRef(null);
  const sharingRequestedRef = useRef(false);
  const connectingRef = useRef(false);
  const subscribedRef = useRef(false);

  const shareLink =
    sessionId && token
      ? `${window.location.origin}/?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`
      : "";

  async function createSession() {
    if (creating) return;

    setCreating(true);
    setStatus("Creating secure session...");

    try {
      const response = await fetch(`${API_URL}/api/sessions`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      setSessionId(data.sessionId);
      setToken(data.token);
      setLocation(null);

      const url = new URL(window.location.href);
      url.searchParams.set("session", data.sessionId);
      url.searchParams.set("token", data.token);
      window.history.pushState({}, "", url);

      setStatus("Session created. Copy and share the link privately.");
    } catch (error) {
      console.error(error);
      setStatus("Could not create session. Check the backend and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setStatus("Share link copied. Send it only to the intended person.");
    } catch {
      setStatus("Copy failed. Select and copy the link manually.");
    }
  }

  function beginGpsSharing() {
    if (!sharingRequestedRef.current || watchRef.current !== null) {
      return;
    }

    if (!navigator.geolocation) {
      setStatus("This browser does not support GPS location.");
      sharingRequestedRef.current = false;
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Open the website using HTTPS to access GPS.");
      sharingRequestedRef.current = false;
      return;
    }

    setStatus("Requesting GPS location. Allow access if prompted...");

    try {
      watchRef.current = navigator.geolocation.watchPosition(
        (result) => {
          const coords = result.coords;
          const nextLocation = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            timestamp: Date.now()
          };

          setLocation(nextLocation);

          const client = clientRef.current;

          if (client?.connected) {
            client.publish({
              destination: `/app/location/${sessionId}`,
              body: JSON.stringify(nextLocation)
            });

            setSharing(true);
            setStatus("You are sharing your location.");
          }
        },
        (error) => {
          let message = "Unable to get GPS location.";

          if (error.code === 1) {
            message = "Location permission denied. Allow it in browser settings.";
          } else if (error.code === 2) {
            message = "Location unavailable. Check your device Location Services.";
          } else if (error.code === 3) {
            message = "GPS timed out. Move to an area with better GPS reception.";
          }

          setStatus(message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 20000
        }
      );
    } catch (error) {
      console.error(error);
      setStatus("Could not start GPS. Check browser permissions.");
      sharingRequestedRef.current = false;
    }
  }

  function connectToSession(shouldShare = false) {
    if (!sessionId || !token) {
      setStatus("Create a session or open a complete shared link first.");
      return;
    }

    if (shouldShare) {
      sharingRequestedRef.current = true;
    }

    const existingClient = clientRef.current;

    if (existingClient?.connected) {
      setConnected(true);
      if (sharingRequestedRef.current) beginGpsSharing();
      else setStatus("Connected. Waiting for the sharer's location...");
      return;
    }

    if (connectingRef.current && existingClient) {
      setStatus("Connecting to the session. Please wait...");
      return;
    }

    connectingRef.current = true;
    subscribedRef.current = false;
    setStatus("Connecting to the live location server...");

    const client = new Client({
      brokerURL: WS_URL,
      connectHeaders: { sessionId, token },
      reconnectDelay: 3000,
      connectionTimeout: 15000,

      onConnect: () => {
        connectingRef.current = false;
        setConnected(true);

        if (!subscribedRef.current) {
          subscribedRef.current = true;

          client.subscribe(`/topic/location/${sessionId}`, (message) => {
            try {
              const data = JSON.parse(message.body);
              const lat = Number(data.latitude);
              const lng = Number(data.longitude);

              if (
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                lat >= -90 && lat <= 90 &&
                lng >= -180 && lng <= 180
              ) {
                setLocation({
                  latitude: lat,
                  longitude: lng
                });
                setStatus("Location received.");
              }
            } catch (error) {
              console.error("Invalid location message.", error);
            }
          });
        }

        if (sharingRequestedRef.current) {
          beginGpsSharing();
        } else {
          setStatus("Connected. Waiting for the sharer's location...");
        }
      },

      onStompError: (frame) => {
        connectingRef.current = false;
        console.error("STOMP error:", frame.headers, frame.body);
        setStatus("Server rejected the connection. Check the session token and backend logs.");
      },

      onWebSocketError: (event) => {
        console.error("WebSocket error:", event);
        setStatus("Connection failed. Check the backend and try again.");
      },

      onWebSocketClose: () => {
        connectingRef.current = false;
        subscribedRef.current = false;
        setConnected(false);
        setStatus("Connection closed. Reconnecting...");
      }
    });

    clientRef.current = client;
    client.activate();
  }

  function startSharing() {
    if (!navigator.geolocation) {
      setStatus("This browser does not support GPS location.");
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Open the website using HTTPS to access GPS.");
      return;
    }

    if (!sessionId || !token) {
      setStatus("Create a session or open a complete shared link first.");
      return;
    }

    if (sharingRequestedRef.current || watchRef.current !== null) {
      setStatus("Location sharing is already starting or active.");
      return;
    }

    sharingRequestedRef.current = true;
    connectToSession(true);
  }

  async function stopSharing() {
    sharingRequestedRef.current = false;

    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }

    setSharing(false);
    setStatus("Sharing stopped.");

    const client = clientRef.current;
    clientRef.current = null;
    connectingRef.current = false;
    subscribedRef.current = false;

    if (client) {
      await client.deactivate();
    }

    setConnected(false);
  }

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
      }

      if (clientRef.current) {
        clientRef.current.deactivate();
      }
    };
  }, []);

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <h1>Live Location Tracker</h1>

      <p>
        Location sharing requires the other person's permission.
        They can stop sharing at any time.
      </p>

      {!sessionId || !token ? (
        <button onClick={createSession} disabled={creating}>
          {creating ? "Creating..." : "Create Secure Session"}
        </button>
      ) : (
        <>
          <p><strong>Session code:</strong> {sessionId}</p>

          <label htmlFor="share-link">Private share link:</label>
          <input
            id="share-link"
            value={shareLink}
            readOnly
            style={{
              display: "block",
              width: "100%",
              padding: 10,
              margin: "8px 0"
            }}
          />

          <button onClick={copyLink}>Copy Link</button>

          <div style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 16
          }}>
            {!connected && (
              <button onClick={() => connectToSession(false)}>
                View Shared Location
              </button>
            )}

            {!sharing && (
              <button onClick={startSharing}>
                Start Sharing My Location
              </button>
            )}

            {sharing && (
              <button onClick={stopSharing}>
                Stop Sharing
              </button>
            )}
          </div>
        </>
      )}

      <p role="status">{status}</p>

      {location && (
        <MapContainer
          center={[location.latitude, location.longitude]}
          zoom={16}
          style={{ height: 450, width: "100%", marginTop: 20 }}
        >
          <MapUpdater location={location} />

          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <Marker position={[location.latitude, location.longitude]}>
            <Popup>Latest shared location</Popup>
          </Marker>
        </MapContainer>
      )}
    </main>
  );
}
