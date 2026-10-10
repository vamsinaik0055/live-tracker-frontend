
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  "wss://live-tracker-backend-1.onrender.com/ws";

export default function App() {
  const [sessionId, setSessionId] = useState(
    () => new URLSearchParams(window.location.search).get("session") || ""
  );
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState("Create a session or open a shared link.");
  const [sharing, setSharing] = useState(false);
  const [connected, setConnected] = useState(false);

  const clientRef = useRef(null);
  const watchRef = useRef(null);

  const shareLink = sessionId
    ? `${window.location.origin}/?session=${encodeURIComponent(sessionId)}`
    : "";

  function createSession() {
    const id = crypto.randomUUID();
    setSessionId(id);
    setLocation(null);

    const url = new URL(window.location.href);
    url.searchParams.set("session", id);
    window.history.pushState({}, "", url);

    setStatus("Session created. Copy the link and share it.");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setStatus("Share link copied. Send it to the other person.");
    } catch {
      setStatus("Copy failed. Select and copy the link manually.");
    }
  }

  function connectToSession(shouldShare) {
    if (!sessionId) {
      setStatus("Create or open a session link first.");
      return;
    }

    if (clientRef.current) {
      setStatus("Already connected to this session.");
      return;
    }

    const client = new Client({
      brokerURL: WS_URL,
      reconnectDelay: 3000,

      onConnect: () => {
        setConnected(true);
        setStatus(
          shouldShare
            ? "Connected. Waiting for GPS location..."
            : "Connected. Waiting for the sharer's location..."
        );

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
              setLocation({ latitude: lat, longitude: lng });
              setStatus("Location received.");
            }
          } catch {
            console.error("Invalid location message.");
          }
        });

        if (shouldShare) {
          watchRef.current = navigator.geolocation.watchPosition(
            (result) => {
              const coords = result.coords;
              const nextLocation = {
                latitude: coords.latitude,
                longitude: coords.longitude,
                timestamp: Date.now()
              };

              setLocation(nextLocation);

              client.publish({
                destination: `/app/location/${sessionId}`,
                body: JSON.stringify(nextLocation)
              });

              setStatus("You are sharing your location.");
            },
            (error) => {
              setStatus(`GPS error: ${error.message}`);
            },
            {
              enableHighAccuracy: true,
              maximumAge: 3000,
              timeout: 15000
            }
          );

          setSharing(true);
        }
      },

      onStompError: () => {
        setStatus("Server error. Check the Spring Boot backend.");
      },

      onWebSocketError: () => {
        setStatus("Connection failed. Please try again.");
      },

      onWebSocketClose: () => {
        setConnected(false);
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

    setStatus("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      () => connectToSession(true),
      (error) => {
        setStatus(
          error.code === 1
            ? "Permission denied. Allow location access in browser settings."
            : "Unable to get GPS location. Check Location Services and retry."
        );
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function stopSharing() {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }

    const client = clientRef.current;
    clientRef.current = null;

    if (client) client.deactivate();

    setSharing(false);
    setConnected(false);
    setStatus("Sharing stopped. Rejoin to view updates again.");
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

      {!sessionId ? (
        <button onClick={createSession}>Create Session</button>
      ) : (
        <>
          <p><strong>Session code:</strong> {sessionId}</p>

          <label htmlFor="share-link">Share this link:</label>
          <input
            id="share-link"
            value={shareLink}
            readOnly
            style={{ display: "block", width: "100%", padding: 10, margin: "8px 0" }}
          />

          <button onClick={copyLink}>Copy Link</button>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            {!connected && !sharing && (
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
