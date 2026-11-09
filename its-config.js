// ============================================================
// ITS — site settings (edit these, then upload this file)
// ============================================================
const ITS_CONFIG = {
  // Public web address of ITS (no trailing slash).
  siteUrl: "https://www.ifwlticketsystem.co.uk",

  // Discord application → OAuth2 → Client ID (a long number). Public — safe
  // to put here. The Client SECRET never goes in this file: it's stored with
  //   firebase functions:secrets:set DISCORD_CLIENT_SECRET
  discordClientId: "PASTE_DISCORD_CLIENT_ID_HERE",

  // Where league owners buy / renew ITS.
  patreonUrl: "https://www.patreon.com/",

  // ITS Support Discord (owners must join).
  supportDiscordUrl: "https://discord.gg/yVMcCAMJPM",

  // Beta length in days, and the subscription lengths you sell (months).
  betaDays: 30,
  planMonths: [1, 3, 12]
};
