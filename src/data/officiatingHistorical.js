export default {
  meta: {
    name: "World Cup officiating historical signal cache",
    version: "0.1.0",
    source_notes: [
      "Curated portfolio seed data for analytics modeling and UI development.",
      "Live match feeds should overwrite these estimates when the worker returns official match stats.",
      "Signal labels intentionally distinguish observed, estimated, and unknown data quality."
    ]
  },
  tournamentDiscipline: [
    { year: 1990, matches: 52, yellow_cards: 193, red_cards: 16, penalties: 18, var_era: false, source_confidence: "observed" },
    { year: 1998, matches: 64, yellow_cards: 250, red_cards: 22, penalties: 18, var_era: false, source_confidence: "estimated" },
    { year: 2006, matches: 64, yellow_cards: 345, red_cards: 28, penalties: 17, var_era: false, source_confidence: "observed" },
    { year: 2010, matches: 64, yellow_cards: 261, red_cards: 17, penalties: 15, var_era: false, source_confidence: "estimated" },
    { year: 2014, matches: 64, yellow_cards: 181, red_cards: 10, penalties: 13, var_era: false, source_confidence: "estimated" },
    { year: 2018, matches: 64, yellow_cards: 219, red_cards: 4, penalties: 29, var_era: true, source_confidence: "observed" },
    { year: 2022, matches: 64, yellow_cards: 227, red_cards: 5, penalties: 23, var_era: true, source_confidence: "estimated" }
  ],
  refereeProfiles: [
    { name: "Szymon Marciniak", country: "Poland", confederation: "UEFA", world_cup_matches: 5, cards_per_match: 4.8, penalties_per_match: 0.4, style: "lets physical play breathe, decisive in penalty-area moments", confidence: "medium" },
    { name: "Antonio Mateu Lahoz", country: "Spain", confederation: "UEFA", world_cup_matches: 4, cards_per_match: 7.0, penalties_per_match: 0.25, style: "high-management, high-card outlier profile", confidence: "high" },
    { name: "Cesar Arturo Ramos", country: "Mexico", confederation: "CONCACAF", world_cup_matches: 7, cards_per_match: 4.4, penalties_per_match: 0.29, style: "firm control, moderate card volume", confidence: "medium" },
    { name: "Alireza Faghani", country: "Australia", confederation: "AFC", world_cup_matches: 6, cards_per_match: 3.8, penalties_per_match: 0.17, style: "experienced, comparatively low volatility", confidence: "medium" },
    { name: "Raphael Claus", country: "Brazil", confederation: "CONMEBOL", world_cup_matches: 2, cards_per_match: 4.5, penalties_per_match: 0.5, style: "small World Cup sample, CONMEBOL domestic experience", confidence: "low" },
    { name: "Unknown", country: "Unknown", confederation: "Unknown", world_cup_matches: 0, cards_per_match: null, penalties_per_match: null, style: "assignment unavailable from live feed", confidence: "unknown" }
  ],
  teamDisciplinePriors: {
    Argentina: { card_risk: 0.78, foul_pressure: 0.72, dissent_risk: 0.7, note: "high emotional and tactical-foul profile in recent knockout history" },
    Netherlands: { card_risk: 0.67, foul_pressure: 0.62, dissent_risk: 0.55, note: "physical duels can spike in knockout matchups" },
    Uruguay: { card_risk: 0.75, foul_pressure: 0.76, dissent_risk: 0.58, note: "historically combative defensive identity" },
    Brazil: { card_risk: 0.42, foul_pressure: 0.51, dissent_risk: 0.38, note: "often absorbs fouls, transition defense can still create tactical cards" },
    France: { card_risk: 0.39, foul_pressure: 0.44, dissent_risk: 0.34, note: "athletic recovery reduces some tactical-foul pressure" },
    Spain: { card_risk: 0.36, foul_pressure: 0.39, dissent_risk: 0.32, note: "possession share can suppress defensive actions" },
    England: { card_risk: 0.34, foul_pressure: 0.42, dissent_risk: 0.35, note: "typically lower card profile, rises against elite transition teams" },
    UnitedStates: { card_risk: 0.5, foul_pressure: 0.55, dissent_risk: 0.38, note: "pressing and recovery defending can lift foul count" },
    Mexico: { card_risk: 0.58, foul_pressure: 0.57, dissent_risk: 0.54, note: "home pressure and rivalry games can increase volatility" },
    Germany: { card_risk: 0.4, foul_pressure: 0.45, dissent_risk: 0.33, note: "structure usually lowers card chaos" }
  },
  signalWeights: {
    referee_strictness: 0.28,
    team_card_pressure: 0.23,
    foul_asymmetry: 0.13,
    var_penalty_environment: 0.14,
    match_stakes: 0.14,
    data_confidence_drag: 0.08
  },
  statDefinitions: [
    { key: "cards", good: "Low card count with balanced foul distribution", poor: "High cards, second-yellow risk, dissent cluster", unknown: "No card feed or referee assignment" },
    { key: "fouls", good: "Fouls align with matchup style and do not distort possession", poor: "One-sided whistle pattern or repeated tactical fouls", unknown: "No official foul count" },
    { key: "offsides", good: "Consistent assistant/VAR timing with few delayed flags", poor: "High disallowed-goal or marginal line frequency", unknown: "No offside feed" },
    { key: "var", good: "Clear interventions with stable penalty standard", poor: "Multiple reviews, penalty reversals, long delays", unknown: "No VAR event feed" },
    { key: "penalties", good: "Penalty decisions align with box-entry pressure", poor: "Unexpected penalty spike relative to touches/attacks", unknown: "No penalty source beyond score events" }
  ]
};
