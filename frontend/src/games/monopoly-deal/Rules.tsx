

export function Rules() {
  return (
    <div className="deal-rulebook">
      <h3>Your first Deal</h3>
      <ol>
        <li>
          Collect three complete property groups of different colors. The first
          to do so wins immediately.
        </li>
        <li>
          Draw two at turn start, or five if your hand is empty. Play up to
          three cards, then end your turn. Discard to seven.
        </li>
        <li>
          Play money or actions into your bank. Properties stay in your property
          collection. Banked actions cannot be used again.
        </li>
        <li>
          Charge rent, trade, or steal. Answer attacks with Just Say No; the
          attacker may counter with another No. Each opponent answers group
          attacks independently.
        </li>
        <li>
          Pay only with tabled assets you choose. No change. If short, give
          every payable asset; zero-value wilds stay. Received properties are
          placed by their new owner.
        </li>
        <li>
          Rearrange properties free during your turn. Fixed properties keep
          their color. Wilds use their printed colors. A group made only of
          rainbow wilds has no rent and cannot be complete.
        </li>
        <li>
          One House (+3M), then one Hotel (+4M), per complete colored group.
          Never on railroads or utilities. If the group becomes incomplete, its
          remaining buildings are discarded. Paid buildings go to the
          recipient’s bank.
        </li>
        <li>
          Sly Deal and Forced Deal cannot take from complete groups. Deal
          Breaker takes the whole complete group, including buildings.
        </li>
      </ol>
      <p>
        Classic follows the Hasbro FAQ (all No responses free); the 2024 printed
        edition charges a play for No during your own turn. Double Rent is
        played together with Rent, costs one play each, and may be used twice if
        you have three plays left.
      </p>
      <a
        href="https://instructions.hasbro.com/en-us/instruction/monopoly-deal-card-game-instructions"
        target="_blank"
        rel="noreferrer"
      >
        Hasbro instructions ↗
      </a>
      <p className="deal-help">
        An unofficial, private game-night adaptation. Original card designs; no
        Hasbro artwork.
      </p>
    </div>
  );
}
