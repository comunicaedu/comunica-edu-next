import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const SECRET_STR = process.env.JWT_SECRET;
if (!SECRET_STR || SECRET_STR.length < 32) {
  throw new Error("JWT_SECRET ausente ou muito curto no .env.local (mínimo 32 chars).");
}

const SECRET = new TextEncoder().encode(SECRET_STR);
const ISSUER = "comunicaedu";
const AUDIENCE = "comunicaedu-app";
const EXPIRATION = "12h";

export interface EduJwtPayload extends JWTPayload {
  sub: string;
  email: string;
  role: "admin" | "client";
  username?: string;
}

export async function signEduJwt(payload: Omit<EduJwtPayload, "iat" | "exp" | "iss" | "aud">) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(EXPIRATION)
    .sign(SECRET);
}

export async function verifyEduJwt(token: string): Promise<EduJwtPayload> {
  const { payload } = await jwtVerify(token, SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload as EduJwtPayload;
}
