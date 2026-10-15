'use strict';
// Original written prompts (authored for Score It, no third-party licensing involved).
const MOODS = [
  { id: 'funny', label: 'Funny' }, { id: 'dramatic', label: 'Dramatic' }, { id: 'romantic', label: 'Romantic' },
  { id: 'suspense', label: 'Suspenseful' }, { id: 'absurd', label: 'Absurd' }, { id: 'emotional', label: 'Emotional' },
];
const RAW = {
  funny: [
    'You confidently walk into the wrong wedding and decide to commit.',
    'A raccoon in a tiny business suit chairs the neighborhood meeting.',
    'You wave back at someone who was not waving at you. Slow motion.',
    'Your dog narrates your terrible cooking attempt with total disappointment.',
    'Grown adults take a game of musical chairs to Olympic levels of seriousness.',
    'You try to sneak out of a party and everyone claps.',
    'The office printer finally dies, and the whole floor holds a funeral.',
    'Two cats in a staring contest that decides the fate of the house.',
  ],
  dramatic: [
    'The hero walks away from the explosion without looking back.',
    'Rain-soaked rooftop. Two old rivals meet one last time.',
    'The final seconds of the championship game. Everyone is on their feet.',
    'The spaceship door opens. Beyond it, a planet no one has ever seen.',
    'A lone rider crests the hill as the army below goes silent.',
    'The orchestra swells as the curtain rises on opening night.',
    'She pushes open the courtroom doors holding the one piece of evidence that changes everything.',
    'The last train leaves, and he is still running down the platform.',
  ],
  romantic: [
    'Two strangers reach for the same umbrella in the rain.',
    'A slow dance in an empty kitchen at midnight.',
    'Reunited at the airport after three years apart.',
    'A first kiss on a quiet rooftop as the city lights flicker on.',
    'Handwritten letters, read aloud on a late train.',
    'The two of them laughing so hard they forget the world exists.',
    'A summer road trip with the windows down and nowhere to be.',
    'A dinner for two that started as a mistake and turned into forever.',
  ],
  suspense: [
    'Footsteps behind you in an empty parking garage.',
    'The lights flicker once, then the whole hallway goes dark.',
    'You find a door in your house that was never there before.',
    'A phone rings in a room that has been locked for twenty years.',
    'The detective realizes the culprit has been in the room all along.',
    'A lighthouse beam sweeps across the water and something moves.',
    'You are being followed by someone who is very bad at hiding.',
    'The elevator stops between floors. A voice whispers from the speaker.',
  ],
  absurd: [
    'Pigeons run a secret underground empire beneath the city park.',
    'A very serious chess match between two toddlers in tiny tuxedos.',
    'You win the lottery and immediately forget how to walk.',
    'An astronaut sells timeshares on the moon.',
    'A knight, a dentist, and a pirate are stuck in the same elevator.',
    'The world\'s slowest car chase.',
    'Giant rubber ducks take over the harbor and demand a meeting.',
    'Everyone in the grocery store suddenly breaks into a choreographed dance.',
  ],
  emotional: [
    'Saying goodbye to the old house for the last time.',
    'A parent watching their child graduate, trying not to cry.',
    'The long drive home after the hardest day.',
    'Two old friends sitting in silence because words are not needed.',
    'Finally finishing the thing you thought you never would.',
    'The first sunrise after the storm.',
    'Opening a box of old photographs and remembering everything.',
    'A grandfather teaches his grandchild how to fish at dawn.',
  ],
};
const ITEMS = Object.entries(RAW).flatMap(([mood, list]) => list.map((caption, i) => ({
  id: `w-${mood}-${i + 1}`, kind: 'text', mood, caption,
  credit: null, license: { name: 'Original Score It prompt', url: '' },
})));
module.exports = { MOODS, ITEMS };
