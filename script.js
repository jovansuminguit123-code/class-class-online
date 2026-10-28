
/* ---------- 1. Supabase ---------- */
const SUPABASE_URL = "https://zshuaqkirawzwtxxbwxr.supabase.co";
const SUPABASE_KEY = "sb_publishable_4OEIvi45MYlFtOTNgt12Og_f0rTddLs";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- 2. HTML elements ---------- */
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let currentUser = null;
const names = {};
let channel = null;

/* ---------- 3. Sign up ---------- */
async function signUp() {
  const name = displayName.value.trim();

  if (name.length < 2 || name.length > 24) {
    authMessage.textContent =
      "Display name must be 2 to 24 characters.";
    return;
  }

  authMessage.textContent = "Creating your account...";

  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: {
      data: { display_name: name }
    }
  });

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  if (!data.session) {
    authMessage.textContent =
      "Check your email to confirm your account.";
  } else {
    authMessage.textContent = "Account created successfully.";
  }
}

/* ---------- 4. Log in ---------- */
async function logIn() {
  authMessage.textContent = "Logging in...";

  const { error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });

  authMessage.textContent = error ? error.message : "";
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  logIn();
});

signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) signUp();
});

logoutBtn.addEventListener("click", async () => {
  const { error } = await sb.auth.signOut();
  if (error) alert("Logout failed: " + error.message);
});

/* ---------- 5. Authentication state ---------- */
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    const user = session?.user || null;

    if (user && (!currentUser || currentUser.id !== user.id)) {
      startChat(user);
    } else if (!user && currentUser) {
      stopChat();
    }
  }, 0);
});

/* ---------- 6. Start and stop chat ---------- */
async function startChat(user) {
  currentUser = user;
  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = "Loading...";

  await loadNames();

  names[user.id] =
    names[user.id] ||
    user.user_metadata?.display_name ||
    user.email ||
    "Me";

  who.textContent = names[user.id];

  await loadMessages();
  listenForNewMessages();
  messageInput.focus();
}

function stopChat() {
  currentUser = null;

  if (channel) sb.removeChannel(channel);
  channel = null;

  messageList.innerHTML = "";
  passwordInput.value = "";
  chatScreen.hidden = true;
  authScreen.hidden = false;
}

/* ---------- 7. Load profiles and messages ---------- */
async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");

  if (error) {
    console.error("Could not load profiles:", error.message);
    return;
  }

  data.forEach((profile) => {
    names[profile.id] = profile.display_name || "Unknown";
  });
}

async function nameFor(userId) {
  if (!names[userId]) {
    const { data, error } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Could not load profile:", error.message);
    }

    names[userId] = data?.display_name || "Unknown";
  }

  return names[userId];
}

async function loadMessages() {
  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Could not load messages:", error.message);
    return;
  }

  messageList.innerHTML = "";

  data.reverse().forEach((message) => {
    showMessage(message);
  });
}

/* ---------- 8. Realtime messages ---------- */
function listenForNewMessages() {
  if (channel) sb.removeChannel(channel);

  channel = sb
    .channel("class-chat")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "messages"
      },
      (payload) => removeMessage(payload.old.id)
    )
    .subscribe();
}

function removeMessage(id) {
  const item = messageList.querySelector(`[data-id="${id}"]`);
  if (item) item.remove();
}

/* ---------- 9. Display a message ---------- */
function showMessage(msg) {
  if (!currentUser || !msg.id) return;

  if (messageList.querySelector(`[data-id="${msg.id}"]`)) return;

  const item = document.createElement("li");
  item.className =
    msg.user_id === currentUser.id ? "message mine" : "message";
  item.dataset.id = msg.id;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[msg.user_id] || "Unknown";

  const text = document.createElement("p");
  text.textContent = msg.content;

  const time = document.createElement("time");
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  item.append(author, text, time);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

/* ---------- 10. Send messages ---------- */
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (!content) return;

  if (content.startsWith("/")) {
    messageInput.value = "";
    await handleCommand(content);
    return;
  }

  if (!currentUser) {
    alert("Mag-login muna bago mag-send.");
    return;
  }

  // Get the currently authenticated Supabase user.
  const {
    data: { user },
    error: authError
  } = await sb.auth.getUser();

  if (authError || !user) {
    alert("Session expired. Mag-login ulit.");
    return;
  }

  // RLS requires user_id to equal auth.uid().
  const { data, error } = await sb
    .from("messages")
    .insert({
      user_id: user.id,
      content: content
    })
    .select("id, user_id, content, created_at")
    .single();

  if (error) {
    console.error("Send message error:", error);
    alert("Could not send: " + error.message);
    return;
  }

  messageInput.value = "";
  await nameFor(data.user_id);
  showMessage(data);
});

/* ---------- 11. Weather command ---------- */
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

async function getWeather(city) {
  const geoResponse = await fetch(
    GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1"
  );

  if (!geoResponse.ok) throw new Error("Geocoding failed");

  const geoData = await geoResponse.json();

  if (!geoData.results?.length) {
    return "Sorry, I could not find a city named " + city + ".";
  }

  const place = geoData.results[0];

  const weatherResponse = await fetch(
    WEATHER_URL +
    "?latitude=" + place.latitude +
    "&longitude=" + place.longitude +
    "&current=temperature_2m,weather_code,wind_speed_10m" +
    "&temperature_unit=fahrenheit"
  );

  if (!weatherResponse.ok) throw new Error("Weather failed");

  const weatherData = await weatherResponse.json();
  const now = weatherData.current;

  return (
    place.name + ", " + (place.country || "") + ": " +
    now.temperature_2m + "°F, " +
    describeWeather(now.weather_code) +
    ", wind " + now.wind_speed_10m + " km/h"
  );
}

function describeWeather(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy to overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown conditions";
}

async function handleCommand(text) {
  const words = text.trim().split(/\s+/);

  if (words[0].toLowerCase() !== "/weather") {
    showBotMessage("Unknown command. Try: /weather Manila");
    return;
  }

  const city = words.slice(1).join(" ");

  if (!city) {
    showBotMessage("Try it like this: /weather Manila");
    return;
  }

  try {
    showBotMessage(await getWeather(city));
  } catch (error) {
    console.error("Weather error:", error);
    showBotMessage("The weather service is not answering right now.");
  }
}

function showBotMessage(text) {
  const item = document.createElement("li");
  item.className = "message bot";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = "WeatherBot (only you can see this)";

  const body = document.createElement("p");
  body.textContent = text;

  item.append(author, body);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}
