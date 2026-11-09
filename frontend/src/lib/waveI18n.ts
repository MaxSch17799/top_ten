import { useInterfaceLanguage } from "../hooks/useInterfaceLanguage";
const de: Record<string, string> = {
  "Assign dial controller": "Reglersteuerung zuweisen",
  "Skip prediction · no bonus": "Vorhersage überspringen · kein Bonus",
  "Choose a guessing teammate": "Wähle eine ratende Person aus dem Team",
  "Wait for the opposing prediction":
    "Warte auf die Vorhersage des anderen Teams",
  "All games": "Alle Spiele",
  "Interface language": "Sprache der Oberfläche",
  "Read the room. Find the frequency.":
    "Spürt die Stimmung. Findet die Wellenlänge.",
  "2–24 players · together or online": "2–24 Personen · zusammen oder online",
  "Your nickname": "Dein Nickname",
  "Spectrum pack": "Spektrenpaket",
  "Create Wavelength lobby": "Wavelength-Lobby erstellen",
  "Creating…": "Wird erstellt…",
  "Have an invite code?": "Du hast einen Einladungscode?",
  Join: "Beitreten",
  "Join Wavelength": "Wavelength beitreten",
  "Join lobby": "Lobby beitreten",
  "Connecting…": "Verbindung wird hergestellt…",
  "Retry connection": "Erneut verbinden",
  "Gather your minds": "Versammelt eure Gedanken",
  "Choose your spectrum": "Wähle dein Spektrum",
  "One thought. One clue.": "Ein Gedanke. Ein Hinweis.",
  "Find your wavelength": "Findet eure Wellenlänge",
  "Which side is the center?": "Auf welcher Seite liegt die Mitte?",
  "Check the score": "Prüft die Punkte",
  "The moment of truth": "Der Moment der Wahrheit",
  "On the same wavelength": "Auf einer Wellenlänge",
  "Invite players": "Spieler einladen",
  "Game code": "Spielcode",
  "Close invite panel": "Einladung schließen",
  "Join link QR code": "QR-Code zum Beitreten",
  "Copy link": "Link kopieren",
  Copied: "Kopiert",
  "Share this link or QR to add players mid-game.":
    "Teile diesen Link oder QR-Code. Neue Personen schauen zunächst zu.",
  "Starter content · 12 spectrums per language. Full 200-pair packs have not been supplied.":
    "Starterinhalt · 12 Spektren pro Sprache. Die vollständigen Pakete mit je 200 Paaren wurden noch nicht bereitgestellt.",
  "How to play": "Spielanleitung",
  "Physical game rulebook": "Regelheft des Brettspiels",
  Psychic: "Medium",
  "Dial controller": "Am Regler",
  Round: "Runde",
  "Remaining rounds": "Verbleibende Runden",
  "Team Sun": "Team Sonne",
  "Team Moon": "Team Mond",
  Together: "Zusammen",
  Spectator: "Zuschauer",
  Host: "Host",
  Online: "Online",
  Offline: "Offline",
  "Randomize teams": "Teams auslosen",
  "Start game": "Spiel starten",
  "Waiting for the host": "Warten auf den Host",
  "Team setup": "Teams einteilen",
  "Competitive needs at least two people per team. Cooperative needs two in total.":
    "Kompetitiv braucht ihr mindestens zwei Personen pro Team. Kooperativ genügen insgesamt zwei.",
  Playing: "Spielt mit",
  "Move up": "Nach oben",
  "Shared display": "Gemeinsamer Bildschirm",
  Fullscreen: "Vollbild",
  "Public view · no secrets": "Öffentliche Ansicht · keine Geheimnisse",
  "Game settings": "Spieleinstellungen",
  "Host controls": "Host-Steuerung",
  "Party · verbal clues": "Party · mündliche Hinweise",
  "Remote · written clues": "Online · geschriebene Hinweise",
  "Interaction mode": "Spielweise",
  "Competitive · two teams": "Kompetitiv · zwei Teams",
  "Cooperative · one team": "Kooperativ · ein Team",
  "Game format": "Spielform",
  "Minimal verbal preset": "Minimaler mündlicher Modus",
  "No typing, no timers, no auto-next. Host confirms the score.":
    "Keine Texteingabe, keine Timer, kein automatischer Rundenwechsel. Der Host bestätigt die Punkte.",
  "Compact layout": "Kompakte Ansicht",
  "Automatic scoring": "Automatische Wertung",
  "Confirm scores as host": "Punkte als Host bestätigen",
  "Spectrum selection": "Spektrumauswahl",
  "Automatic · fast party default": "Automatisch · schneller Party-Standard",
  "Psychic chooses one of two": "Medium wählt eines von zwei",
  "Timers · 0 disables": "Timer · 0 deaktiviert",
  "Clue preparation (seconds)": "Hinweisvorbereitung (Sekunden)",
  "Team discussion (seconds)": "Teamdiskussion (Sekunden)",
  "Prediction (seconds)": "Vorhersage (Sekunden)",
  "Auto-next delay (0 or 5–120 seconds)":
    "Automatischer Wechsel (0 oder 5–120 Sekunden)",
  "Automatic expiry actions": "Automatische Aktionen bei Ablauf",
  "Timer expiry usually warns. Automatic expiry locks the current dial or skips a missing prediction without a bonus. It never invents a clue.":
    "Timer warnen normalerweise nur. Bei automatischem Ablauf wird der aktuelle Regler bestätigt oder eine fehlende Vorhersage ohne Bonus übersprungen. Hinweise werden nie erfunden.",
  "House rules · defaults follow the physical game":
    "Hausregeln · Standard entspricht dem Brettspiel",
  "Target score": "Zielpunktzahl",
  "Fixed total rounds (0 = target score)":
    "Feste Rundenzahl (0 = Zielpunktzahl)",
  "Second team starts with 1 point": "Zweites Team startet mit 1 Punkt",
  "Catch-up turns": "Aufholrunden",
  "Left/right bonus point": "Links-/Rechts-Bonuspunkt",
  "Cooperative starting rounds": "Kooperative Startrunden",
  "Center earns a bonus round": "Mitte bringt eine Bonusrunde",
  "Apply settings": "Einstellungen übernehmen",
  "Changes to mode and content apply next round; timers change immediately.":
    "Spielweise und Inhalt ändern sich nächste Runde; Timer sofort.",
  "Private · only you can see this target":
    "Privat · nur du siehst dieses Ziel",
  "You are the Psychic": "Du bist das Medium",
  "Peek at target": "Ziel ansehen",
  "Hide target": "Ziel verbergen",
  "Give one clue aloud. Your team can move the dial immediately. Then stay silent until reveal.":
    "Gib einen Hinweis laut. Dein Team kann sofort am Regler drehen. Bleibe danach bis zur Auflösung still.",
  "One existing thing, on topic. No endpoint synonyms or numeric codes. Aim for five words or fewer, without qualifiers.":
    "Ein existierender Begriff, passend zum Thema. Keine Synonyme der Endpunkte oder Zahlencodes. Möglichst höchstens fünf Wörter, ohne Einschränkungen.",
  "Your clue": "Dein Hinweis",
  "Give clue": "Hinweis geben",
  "The Psychic is preparing a clue.": "Das Medium bereitet einen Hinweis vor.",
  "Say your clue aloud. Discuss, move the dial, then lock it.":
    "Hinweis laut nennen. Diskutieren, Regler drehen und bestätigen.",
  "Take the dial": "Regler übernehmen",
  "Lock dial": "Regler bestätigen",
  "Dial locked": "Regler bestätigt",
  LEFT: "LINKS",
  RIGHT: "RECHTS",
  "Opposing team: is the target center left or right of the needle?":
    "Anderes Team: Liegt die Zielmitte links oder rechts vom Zeiger?",
  "The opposing team is choosing left or right.":
    "Das andere Team wählt links oder rechts.",
  "You are watching. The host can add you between rounds.":
    "Du schaust zu. Der Host kann dich zwischen den Runden hinzufügen.",
  Points: "Punkte",
  "Opponent points": "Punkte des anderen Teams",
  "Confirm score": "Punkte bestätigen",
  "Next round": "Nächste Runde",
  "Show final result": "Endergebnis zeigen",
  "Center hit · extra round!": "Mitte getroffen · Bonusrunde!",
  "Catch-up! Same team, new Psychic.":
    "Aufgeholt! Gleiches Team, neues Medium.",
  "Sudden death · both teams get a turn before comparison.":
    "Stechen · beide Teams kommen vor dem Vergleich einmal dran.",
  Winner: "Gewinner",
  "Final score": "Endpunktzahl",
  Discussion: "Diskussion",
  Message: "Nachricht",
  Send: "Senden",
  "Psychic stays silent until reveal":
    "Das Medium bleibt bis zur Auflösung still",
  Pause: "Pausieren",
  Paused: "Pausiert",
  Resume: "Fortsetzen",
  "Reset timer": "Timer zurücksetzen",
  "+30 seconds": "+30 Sekunden",
  "Time is up": "Die Zeit ist um",
  "Replace spectrum before clue": "Spektrum vor dem Hinweis ersetzen",
  "Replace Psychic with fresh target": "Medium mit neuem Ziel ersetzen",
  "Reopen dial": "Regler erneut freigeben",
  Reason: "Begründung",
  "Void round / fresh target": "Runde annullieren / neues Ziel",
  "Correct latest score": "Letzte Wertung korrigieren",
  "Apply correction": "Korrektur übernehmen",
  "Transfer host": "Host übertragen",
  "Recover host after 60 seconds offline":
    "Host nach 60 Sekunden offline übernehmen",
  "Return to lobby / reset scores": "Zur Lobby / Punkte zurücksetzen",
  "Reset scores and return to lobby?": "Punkte zurücksetzen und zur Lobby?",
  "End game": "Spiel beenden",
  "End this game?": "Dieses Spiel beenden?",
  "Recent rounds": "Letzte Runden",
  Void: "Annulliert",
  "Audit history": "Änderungsprotokoll",
  "Reconnecting… updates resume automatically.":
    "Verbindung wird wiederhergestellt… Updates kommen automatisch.",
  "State changed. Please try again.":
    "Der Spielstand hat sich geändert. Bitte erneut versuchen.",
  "Only the host can do that": "Das darf nur der Host",
  "Game is paused": "Das Spiel ist pausiert",
  "Each active team needs a Psychic and a guesser":
    "Jedes aktive Team braucht ein Medium und eine ratende Person",
  "A short reason is required": "Eine kurze Begründung ist erforderlich",
  "Mode, pack, selection and scoring confirmation changes apply next round.":
    "Spielweise, Paket, Auswahl und Punktebestätigung ändern sich nächste Runde.",
  "Time is up. Finish the current action when ready.":
    "Die Zeit ist um. Beendet eure Aktion in Ruhe.",
  "Game ended by the host.": "Vom Host beendet.",
  "Room expired after inactivity.":
    "Der Raum ist wegen Inaktivität abgelaufen.",
  "Shared display link is missing.":
    "Der Link für den gemeinsamen Bildschirm fehlt.",
  "A revealed target cannot be hidden again":
    "Ein aufgedecktes Ziel kann nicht wieder verborgen werden",
  "Are you sure it’s plugged in?": "Ist der Stecker wirklich drin?",
  "Try turning it off and back on again":
    "Versucht es aus- und wieder einzuschalten",
  "Blow into the bottom of the device": "Pustet unten in das Gerät",
  "Not bad! Not great, but not bad":
    "Nicht schlecht! Nicht großartig, aber nicht schlecht",
  "So close": "So knapp",
  "You won!": "Ihr habt gewonnen!",
  "You’re on the same wavelength": "Ihr seid auf einer Wellenlänge",
  "Galaxy brain": "Galaktisches Gehirn",
  Insane: "Wahnsinn",
};
export type WaveTranslate = (text: string) => string;
export function useWaveLanguage() {
  const { language, setLanguage } = useInterfaceLanguage();
  const t: WaveTranslate = text => language === 'de' ? de[text] ?? text : text;
  return { language, setLanguage, t };
}
export const waveRules = {
  en: "The Psychic privately sees the target and gives one clue along the spectrum. Their teammates talk and turn one shared dial. After lock-in, the other team predicts left or right of the needle. Reveal: center 4, adjacent 3, outer 2, otherwise 0. A correct prediction earns 1, except on a center hit. First team starts at 0, second at 1. Reach 10 to win; tied games use complete two-turn sudden-death pairs. A center hit while still behind earns an immediate turn with a different Psychic. Cooperative: one team, 7 rounds, no prediction; the center scores 3 and earns an extra round. Other 3-point wedges do not earn a round. Timers, automatic spectrum choice, shared dial control and automatic reveal are digital conveniences; custom scoring and lengths are house rules.",
  de: "Das Medium sieht das Ziel geheim und gibt einen Hinweis auf dem Spektrum. Sein Team diskutiert und dreht einen gemeinsamen Regler. Nach dem Bestätigen sagt das andere Team links oder rechts vom Zeiger voraus. Auflösung: Mitte 4, daneben 3, außen 2, sonst 0 Punkte. Eine richtige Vorhersage bringt 1 Punkt, außer bei einem Mittentreffer. Das erste Team startet mit 0, das zweite mit 1. Wer 10 erreicht, gewinnt; bei Gleichstand spielt jedes Team eine volle Stechen-Runde. Ein Mittentreffer bei weiterem Rückstand bringt sofort eine weitere Runde mit einem anderen Medium. Kooperativ: ein Team, 7 Runden, keine Vorhersage; die Mitte zählt 3 und bringt eine Bonusrunde. Andere 3-Punkte-Felder bringen keine Bonusrunde. Timer, automatische Spektrumauswahl, gemeinsame Reglersteuerung und automatische Auflösung sind digitale Hilfen; eigene Wertung und Spiellänge sind Hausregeln.",
};
export function coopBand(score: number) {
  return [
    "Are you sure it’s plugged in?",
    "Try turning it off and back on again",
    "Blow into the bottom of the device",
    "Not bad! Not great, but not bad",
    "So close",
    "You won!",
    "You’re on the same wavelength",
    "Galaxy brain",
    "Insane",
  ][Math.min(8, Math.max(0, Math.ceil(score / 3) - 1))];
}
