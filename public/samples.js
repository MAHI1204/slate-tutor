const item = (label, detail) => ({ label, detail });
const scene = (heading, explanation, type, ...items) =>
  ({ heading, explanation, diagram: { type, items } });

export const samples = {
  predictor: {
    title: 'Trace a two-bit branch predictor',
    steps: [
      scene('Read the direction counter', 'Consider one conditional branch with a dedicated two-bit counter. For this example there is no aliasing and every update finishes before the next prediction.', 'table',
        item('00 · strongly not taken', 'Predict not taken'), item('01 · weakly not taken', 'Predict not taken'), item('10 · weakly taken', 'Predict taken'), item('11 · strongly taken', 'Predict taken')),
      scene('Follow a taken outcome', 'Start in 01. Read the upper bit before updating: it is zero, so predict not taken. The branch resolves taken. Count one miss and increment the counter to 10.', 'flow',
        item('Predict', '01 → not taken'), item('Resolve', 'Observed outcome: taken'), item('Train', '01 + 1 → 10')),
      scene('Trace three predictions', 'Starting in 01, apply the outcomes taken, taken, not taken. Each row starts from the state left by the previous row. Two of the three predictions miss.', 'table',
        item('01 · predict NT', 'Actual T → miss → 10'), item('10 · predict T', 'Actual T → hit → 11'), item('11 · predict T', 'Actual NT → miss → 10')),
      { ...scene('Check your prediction', 'Continue from state 10. Make your prediction before revealing the answer.', 'compare',
        item('Current counter', '10 · weakly taken'), item('Next actual outcome', 'Not taken')),
        check: { question: 'What is the prediction and the state after training?', answer: 'Predict taken, record a miss, and decrement from 10 to 01.' } }
    ]
  },
  plant: {
    title: 'How photosynthesis works',
    steps: [
      scene('Follow the energy and the matter', 'A leaf uses light energy to build sugars from carbon dioxide and water. Follow the carbon and the energy separately.', 'compare',
        item('Energy', 'Light arrives from the Sun'), item('Carbon', 'Carbon dioxide enters through tiny pores in the leaf')),
      scene('Capture light', 'Inside chloroplasts, pigments absorb light. The light reactions use water and produce oxygen. They also supply ATP and NADPH for the next stage.', 'flow',
        item('Light absorption', 'Pigments absorb incoming light'), item('Energy transfer', 'The light reactions produce ATP and NADPH')),
      scene('Build sugar', 'The Calvin cycle uses ATP and NADPH to turn carbon from carbon dioxide into small sugar molecules. The plant can use these to make sucrose or starch.', 'steps',
        item('Fix carbon', 'Incorporate carbon dioxide into an organic molecule'), item('Make sugar precursors', 'Use energy and reducing power from the light reactions')),
      scene('Check the oxygen', 'Where did the oxygen released by a leaf come from? It came from water split during the light reactions. The carbon in sugar came from carbon dioxide.', 'compare',
        item('Released oxygen', 'From water'), item('Carbon in sugar', 'From carbon dioxide'))
    ]
  },
  moon: {
    title: 'Why the Moon changes shape',
    steps: [
      scene('One Moon, changing view',
        'The Moon does not change shape during its orbit. Sunlight illuminates half of it. From Earth we see a changing fraction of that bright half.',
        'flow', item('Sunlight', 'Lights the half facing the Sun'), item('Moon', 'Moves around Earth'), item('Earth', 'Sees different amounts of the lit half')),
      scene('New Moon and full Moon',
        'At new Moon, the Moon is roughly between Earth and the Sun, so the lit half mostly faces away from us. At full Moon, the Moon is roughly on the opposite side of Earth from the Sun, so nearly all of its bright half faces us.',
        'compare', item('New Moon', 'The near side appears mostly dark'), item('Full Moon', 'The near side appears almost fully lit')),
      scene('Why a quarter looks like a half',
        'A quarter Moon looks half lit from Earth. The word quarter describes how far the Moon has moved through its cycle, not the fraction of its face that looks bright.',
        'compare', item('Progress through the cycle', 'About one quarter at first quarter'), item('Illuminated disk we see', 'About one half at first quarter')),
      scene('Check your mental model',
        'Suppose the Moon and Sun are on nearly opposite sides of our sky. Which phase should you expect? The Moon will be near full because its sunlit side is pointed toward Earth.',
        'steps', item('Picture the positions', 'Sun and Moon in opposite directions'), item('Predict the view', 'Most of the bright side faces Earth'), item('Answer', 'Near full Moon'))
    ]
  },
  search: {
    title: 'How binary search works',
    steps: [
      scene('The sorted list is the clue',
        'If values are sorted, one comparison at the middle tells you which half cannot contain the target. You can ignore that half and repeat on the rest.',
        'flow', item('Sorted list', 'A condition the method needs'), item('Inspect the middle', 'Compare its value with the target'), item('Keep one half', 'Only one half can still contain the target')),
      scene('Find 21 in a seven-item list',
        'Start with 2, 5, 8, 12, 16, 21 and 34. The middle is 12. Since 21 is larger, look at 16, 21 and 34. Their middle is 21, so the second comparison finds it.',
        'steps', item('Compare 21 to 12', 'The target is larger'), item('Search 16, 21, 34', 'Keep the upper half'), item('Compare 21 to 21', 'The target is found')),
      scene('Why it scales',
        'A sequential search may check every item. Binary search repeatedly halves the remaining interval. Its worst-case comparison count grows logarithmically as the list grows.',
        'compare', item('Linear search', 'Worst-case work grows with n'), item('Binary search', 'Worst-case work grows with log₂ n'))
    ]
  }
};
