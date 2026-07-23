import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "jsr:@simplewebauthn/server@13";
import { isoBase64URL, isoUint8Array } from "jsr:@simplewebauthn/server@13/helpers";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RP_NAME = "TSV Hainsfarth Tippspiel";
const PASSKEY_TTL_MS = 10 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const normalizePlayerName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });

const errorResponse = (message: string, status = 400) =>
  json({ error: message }, { status });

const resolveRpConfig = (originHeader: string | null) => {
  if (!originHeader) {
    throw new Error("Origin fehlt.");
  }

  const origin = new URL(originHeader);
  const hostname = origin.hostname.toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return {
      origin: origin.origin,
      rpID: hostname,
    };
  }

  if (hostname === "www.tsv-hainsfarth.de" || hostname === "tsv-hainsfarth.de") {
    return {
      origin: origin.origin,
      rpID: "tsv-hainsfarth.de",
    };
  }

  if (hostname.endsWith(".github.io")) {
    return {
      origin: origin.origin,
      rpID: hostname,
    };
  }

  throw new Error("Diese Herkunft ist fuer Passkeys nicht freigeschaltet.");
};

const authenticatePlayer = async (playerName: string, pin: string) => {
  const { data, error } = await admin.rpc("authenticate_tippspiel_player", {
    p_player_name: playerName,
    p_pin: pin,
  });

  if (error) {
    throw new Error(error.message || "PIN oder Name konnten nicht geprueft werden.");
  }

  if (!data?.player_id) {
    throw new Error("Spieler konnte nicht geprueft werden.");
  }

  return data as { player_id: string; player_name: string; player_key: string };
};

const getPlayerByName = async (playerName: string) => {
  const playerKey = normalizePlayerName(playerName);

  const { data, error } = await admin
    .from("tippspiel_players")
    .select("id, display_name, display_name_key, is_active")
    .eq("display_name_key", playerKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Spieler konnte nicht geladen werden.");
  }

  if (!data?.id) {
    throw new Error("Dieser Name ist noch nicht registriert.");
  }

  return data;
};

const getPlayerPasskeys = async (playerId: string) => {
  const { data, error } = await admin
    .from("tippspiel_passkeys")
    .select("id, credential_id, public_key, counter, transports, device_type, backed_up")
    .eq("player_id", playerId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Passkeys konnten nicht geladen werden.");
  }

  return data || [];
};

const storeChallenge = async (
  playerId: string,
  flow: "register" | "submit",
  challenge: string,
  payload: Record<string, unknown>
) => {
  await admin.from("tippspiel_passkey_challenges").delete().eq("player_id", playerId).eq("flow", flow);

  const { error } = await admin.from("tippspiel_passkey_challenges").insert({
    player_id: playerId,
    flow,
    challenge,
    payload,
    expires_at: new Date(Date.now() + PASSKEY_TTL_MS).toISOString(),
  });

  if (error) {
    throw new Error(error.message || "Passkey-Challenge konnte nicht gespeichert werden.");
  }
};

const getChallenge = async (playerId: string, flow: "register" | "submit") => {
  const { data, error } = await admin
    .from("tippspiel_passkey_challenges")
    .select("id, challenge, payload, expires_at")
    .eq("player_id", playerId)
    .eq("flow", flow)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Passkey-Challenge konnte nicht geladen werden.");
  }

  if (!data?.id) {
    throw new Error("Passkey-Anfrage ist abgelaufen. Bitte nochmal versuchen.");
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    await admin.from("tippspiel_passkey_challenges").delete().eq("id", data.id);
    throw new Error("Passkey-Anfrage ist abgelaufen. Bitte nochmal versuchen.");
  }

  return data;
};

const clearChallenge = async (challengeId: string) => {
  await admin.from("tippspiel_passkey_challenges").delete().eq("id", challengeId);
};

const getOpenMatch = async (matchId: string) => {
  const { data, error } = await admin
    .from("tippspiel_matches")
    .select("id, starts_at")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Spiel konnte nicht geladen werden.");
  }

  if (!data?.id) {
    throw new Error("Spiel nicht gefunden.");
  }

  if (new Date(data.starts_at).getTime() <= Date.now()) {
    throw new Error("Spiel bereits geschlossen.");
  }

  return data;
};

const savePrediction = async (
  player: { id: string; display_name: string; display_name_key: string },
  matchId: string,
  predictedHomeScore: number,
  predictedAwayScore: number
) => {
  const payload = {
    match_id: matchId,
    player_id: player.id,
    player_name: player.display_name,
    player_key: player.display_name_key,
    predicted_home_score: Math.max(0, Math.min(20, predictedHomeScore)),
    predicted_away_score: Math.max(0, Math.min(20, predictedAwayScore)),
  };

  const { error } = await admin
    .from("tippspiel_predictions")
    .upsert(payload, { onConflict: "match_id,player_id" });

  if (error) {
    throw new Error(error.message || "Tipp konnte nicht gespeichert werden.");
  }

  return payload;
};

const handleRegisterOptions = async (body: { playerName?: string; pin?: string }, originHeader: string | null) => {
  const playerName = body.playerName?.replace(/\s+/g, " ").trim() || "";
  const pin = body.pin?.trim() || "";
  const player = await authenticatePlayer(playerName, pin);
  const rp = resolveRpConfig(originHeader);
  const passkeys = await getPlayerPasskeys(player.player_id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: player.player_key,
    userDisplayName: player.player_name,
    userID: isoUint8Array.fromUTF8String(`tippspiel:${player.player_id}`),
    attestationType: "none",
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports || undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  await storeChallenge(player.player_id, "register", options.challenge, {
    origin: rp.origin,
    rpID: rp.rpID,
  });

  return json({ options });
};

const handleRegisterVerify = async (
  body: { playerName?: string; pin?: string; credential?: Record<string, unknown> },
  originHeader: string | null
) => {
  const playerName = body.playerName?.replace(/\s+/g, " ").trim() || "";
  const pin = body.pin?.trim() || "";
  const credential = body.credential;

  if (!credential) {
    throw new Error("Passkey-Antwort fehlt.");
  }

  const player = await authenticatePlayer(playerName, pin);
  const challenge = await getChallenge(player.player_id, "register");
  const rp = resolveRpConfig(originHeader);

  const verification = await verifyRegistrationResponse({
    response: credential as never,
    expectedChallenge: challenge.challenge,
    expectedOrigin: String(challenge.payload?.origin || rp.origin),
    expectedRPID: String(challenge.payload?.rpID || rp.rpID),
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7, -257],
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey konnte nicht bestaetigt werden.");
  }

  const registrationInfo = verification.registrationInfo as Record<string, unknown>;
  const credentialInfo =
    (registrationInfo.credential as Record<string, unknown> | undefined) ||
    {
      id: registrationInfo.credentialID,
      publicKey: registrationInfo.credentialPublicKey,
      counter: registrationInfo.counter,
      transports: (credential as { response?: { transports?: string[] } }).response?.transports || [],
    };

  const credentialId = String(credentialInfo.id || "");
  const publicKey = credentialInfo.publicKey as Uint8Array;
  const counter = Number(credentialInfo.counter || 0);
  const transports =
    ((credentialInfo.transports as string[] | undefined) ||
      (credential as { response?: { transports?: string[] } }).response?.transports ||
      []) as string[];

  if (!credentialId || !publicKey) {
    throw new Error("Passkey-Daten sind unvollstaendig.");
  }

  const { error } = await admin.from("tippspiel_passkeys").upsert(
    {
      player_id: player.player_id,
      credential_id: credentialId,
      public_key: isoBase64URL.fromBuffer(publicKey),
      counter,
      transports,
      device_type: String(registrationInfo.credentialDeviceType || ""),
      backed_up: Boolean(registrationInfo.credentialBackedUp),
    },
    { onConflict: "credential_id" }
  );

  if (error) {
    throw new Error(error.message || "Passkey konnte nicht gespeichert werden.");
  }

  await clearChallenge(challenge.id);

  return json({
    verified: true,
    player_name: player.player_name,
  });
};

const handleSubmitOptions = async (
  body: {
    playerName?: string;
    matchId?: string;
    predictedHomeScore?: number;
    predictedAwayScore?: number;
  },
  originHeader: string | null
) => {
  const playerName = body.playerName?.replace(/\s+/g, " ").trim() || "";
  const matchId = body.matchId?.trim() || "";
  const predictedHomeScore = Math.max(0, Math.min(20, Number(body.predictedHomeScore) || 0));
  const predictedAwayScore = Math.max(0, Math.min(20, Number(body.predictedAwayScore) || 0));

  const player = await getPlayerByName(playerName);
  const passkeys = await getPlayerPasskeys(player.id);

  if (!passkeys.length) {
    throw new Error("Fuer diesen Namen ist noch kein Face-ID- oder Fingerabdruck-Login hinterlegt.");
  }

  await getOpenMatch(matchId);

  const rp = resolveRpConfig(originHeader);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports || undefined,
    })),
    userVerification: "preferred",
  });

  await storeChallenge(player.id, "submit", options.challenge, {
    origin: rp.origin,
    rpID: rp.rpID,
    matchId,
    predictedHomeScore,
    predictedAwayScore,
  });

  return json({ options });
};

const handleSubmitVerify = async (
  body: { playerName?: string; credential?: { id?: string } & Record<string, unknown> },
  originHeader: string | null
) => {
  const playerName = body.playerName?.replace(/\s+/g, " ").trim() || "";
  const credential = body.credential;

  if (!credential?.id) {
    throw new Error("Passkey-Antwort fehlt.");
  }

  const player = await getPlayerByName(playerName);
  const challenge = await getChallenge(player.id, "submit");
  const rp = resolveRpConfig(originHeader);
  const matchId = String(challenge.payload?.matchId || "");
  const predictedHomeScore = Number(challenge.payload?.predictedHomeScore || 0);
  const predictedAwayScore = Number(challenge.payload?.predictedAwayScore || 0);

  const { data: passkey, error: passkeyError } = await admin
    .from("tippspiel_passkeys")
    .select("id, credential_id, public_key, counter, transports")
    .eq("player_id", player.id)
    .eq("credential_id", credential.id)
    .maybeSingle();

  if (passkeyError) {
    throw new Error(passkeyError.message || "Passkey konnte nicht geladen werden.");
  }

  if (!passkey?.id) {
    throw new Error("Dieser Passkey ist fuer den Namen nicht hinterlegt.");
  }

  const verification = await verifyAuthenticationResponse({
    response: credential as never,
    expectedChallenge: challenge.challenge,
    expectedOrigin: String(challenge.payload?.origin || rp.origin),
    expectedRPID: String(challenge.payload?.rpID || rp.rpID),
    credential: {
      id: passkey.credential_id,
      publicKey: isoBase64URL.toBuffer(passkey.public_key),
      counter: Number(passkey.counter || 0),
      transports: passkey.transports || undefined,
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new Error("Passkey konnte nicht bestaetigt werden.");
  }

  await getOpenMatch(matchId);

  const savedPrediction = await savePrediction(player, matchId, predictedHomeScore, predictedAwayScore);

  const { error: updateError } = await admin
    .from("tippspiel_passkeys")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
      device_type: verification.authenticationInfo.credentialDeviceType,
      backed_up: verification.authenticationInfo.credentialBackedUp,
    })
    .eq("id", passkey.id);

  if (updateError) {
    throw new Error(updateError.message || "Passkey konnte nicht aktualisiert werden.");
  }

  await clearChallenge(challenge.id);

  return json({
    verified: true,
    player_name: player.display_name,
    predicted_home_score: savedPrediction.predicted_home_score,
    predicted_away_score: savedPrediction.predicted_away_score,
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Nur POST wird unterstuetzt.", 405);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase-Service-Role-Key fehlt in der Function.");
    }

    const url = new URL(req.url);
    const body = await req.json();

    if (url.pathname.endsWith("/register/options")) {
      return await handleRegisterOptions(body, req.headers.get("origin"));
    }

    if (url.pathname.endsWith("/register/verify")) {
      return await handleRegisterVerify(body, req.headers.get("origin"));
    }

    if (url.pathname.endsWith("/submit/options")) {
      return await handleSubmitOptions(body, req.headers.get("origin"));
    }

    if (url.pathname.endsWith("/submit/verify")) {
      return await handleSubmitVerify(body, req.headers.get("origin"));
    }

    return errorResponse("Route nicht gefunden.", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return errorResponse(message, 400);
  }
});
