"use client";

import Image, { type StaticImageData } from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import claudeChip55Recipes from "../../assets/images/claude-chip-55recipes.webp";
import claudeChipInspired from "../../assets/images/claude-chip-inspired.jpg";
import claudeChipMummyrecipes from "../../assets/images/claude-chip-mummyrecipes.jpg";

const PROMPT =
  "Give me the most perfect, best-tasting, addictive, but healthy potato chips recipe.";
const REVEAL_INITIAL_DELAY_MS = 700;
const REVEAL_STAGGER_MS = 140;
const REVEAL_LINE_DURATION_MS = 720;
const REVEAL_COMPLETION_BUFFER_MS = 650;
const RECIPE_LINE_MAX_LENGTH = 104;

type RecipeModel = "gpt" | "claude" | "gemini";

type RevealStyle = CSSProperties & {
  "--recipe-reveal-index": number;
};

const REVEAL_SELECTOR =
  ".recipe-response-reveal, .recipe-response-reveal-line, .recipe-response-reveal-list-item, .claude-recipe-card";

const claudeWebResults = [
  {
    alt: "Golden potato chips piled in a serving dish.",
    label: "Image: mummyrecipes",
    src: claudeChipMummyrecipes,
  },
  {
    alt: "Close-up of crisp golden potato chips.",
    label: "Image: 55recipes",
    src: claudeChip55Recipes,
  },
  {
    alt: "Baked potato chips in a white dish.",
    label: "Image: ar.inspiredpencil",
    src: claudeChipInspired,
  },
] satisfies Array<{ alt: string; label: string; src: StaticImageData }>;

const modelOptions: Array<{
  id: RecipeModel;
  label: string;
}> = [
  { id: "gpt", label: "GPT-5.5 Pro" },
  { id: "claude", label: "Opus 4.7 Adaptive" },
  { id: "gemini", label: "Gemini 3.1 Pro" },
];

const chipsIngredients = [
  "2 lb russet or Yukon Gold potatoes",
  "6 cups cold water",
  "\u2153 cup white vinegar or apple cider vinegar",
  "1\u00bd tsp kosher salt",
  "1\u00bd tbsp avocado oil or olive oil",
];

const seasoningIngredients = [
  "1\u00bd tbsp nutritional yeast",
  "1 tsp onion powder",
  "\u00be tsp garlic powder",
  "\u00bd tsp smoked paprika",
  "\u00bd tsp fine salt, plus more to taste",
  "\u00bc tsp mustard powder",
  "\u00bc tsp black pepper",
  "\u215b tsp citric acid or \u00bd tsp vinegar powder, optional but excellent",
  "\u215b tsp MSG, optional, for savory snack-shop flavor with less salt",
];

const methodSteps = [
  "Slice the potatoes very thin, about 1/16 inch thick. A mandoline gives the best result.",
  "Put the slices in a bowl with the cold water, vinegar, and kosher salt. Soak for 25 to 30 minutes. This removes excess starch, adds brightness, and helps the chips crisp without needing much oil.",
  "Drain and rinse the potatoes well. Pat them very dry with towels. Let them sit uncovered for another 10 minutes if you have time. Dry potatoes crisp much better.",
  "Toss the slices with the avocado oil or olive oil. Use just enough to lightly coat them; they should look barely glossy, not wet.",
  "Grind or blend the seasoning into a fine powder. Fine seasoning sticks better and tastes more like real packaged chips.",
];

const airFryerSteps = [
  "Preheat the air fryer to 300\u00b0F / 150\u00b0C.",
  "Arrange the potato slices in a mostly single layer. A little overlap is okay, but do not pile them thickly.",
  "Cook for 8 minutes, shaking or separating slices halfway through.",
  "Raise the heat to 360\u00b0F / 182\u00b0C and cook for another 6 to 10 minutes, shaking every 2 minutes, until the chips are golden and crisp. Pull out any chips that finish early.",
  "Immediately toss the hot chips with the seasoning.",
  "Let them cool for 5 minutes before eating. They get crispier as they cool.",
];

const ovenSteps = [
  "Preheat oven to 400\u00b0F / 205\u00b0C, preferably convection.",
  "Arrange slices in a single layer on parchment-lined baking sheets.",
  "Bake for 15 to 25 minutes, flipping once, until golden and crisp around the edges. Remove finished chips as they crisp; thinner ones may finish early.",
  "Toss with seasoning while hot.",
];

const variationIngredients = [
  "1 tbsp powdered Greek yogurt, buttermilk powder, or powdered sour cream",
  "\u00bd tsp dried dill",
  "\u00bd tsp dried parsley",
  "Extra pinch of onion powder",
];

const claudeIngredients = [
  "2 large russet or Yukon Gold potatoes (skin on)",
  "1 tablespoons extra-virgin olive oil or avocado oil",
  "1 teaspoons white vinegar",
  "1 tablespoons nutritional yeast",
  "0.8 teaspoons flaky sea salt",
  "0.5 teaspoons smoked paprika",
  "0.3 teaspoons garlic powder",
  "0.3 teaspoons onion powder",
  "0.3 teaspoons freshly ground black pepper",
  "0.1 teaspoons MSG (optional, but transformative)",
];

const claudeSteps = [
  {
    title: "Preheat the oven",
    text: "Position two racks in the upper-middle and lower-middle of your oven and preheat to 400\u00b0F (205\u00b0C). Line two large baking sheets with parchment paper (not foil - chips stick to foil). A hot oven and parchment are non-negotiable for crispness.",
  },
  {
    title: "Slice paper-thin",
    text: "Scrub 2 large russet or Yukon Gold potatoes (skin on) well. Using a mandoline set to 1.5mm (1/16 inch), slice into uniform rounds. Use the hand guard. Uniform thickness is the difference between evenly crisp chips and a mix of burnt and bendy ones.",
  },
  {
    title: "Quick acidulated soak",
    text: "Submerge slices in a large bowl of cold water with 1 teaspoons white vinegar. Swirl with your hand - the water will cloud immediately with released starch. Let soak. The vinegar firms the pectin in the cell walls and the cold water rinse prevents the chips from sticking or going gummy in the oven.",
  },
  {
    title: "Dry meticulously",
    text: "Drain the slices and spread them on clean kitchen towels in a single layer. Top with another towel and press firmly, then blot any stubborn wet spots. They should feel dry to the touch. This is THE step most people half-ass - any leftover moisture means steam in the oven, which means soft chips.",
  },
  {
    title: "Mix the umami seasoning",
    text: "In a small bowl, combine nutritional yeast, flaky sea salt, smoked paprika, garlic powder, onion powder, freshly ground black pepper, and MSG if using. Rub between your fingers to break up any clumps.",
  },
  {
    title: "Coat with oil and seasoning",
    text: "Transfer dried slices to a large bowl. Drizzle with olive oil or avocado oil and toss gently with your hands until every slice has a thin, even sheen. Sprinkle about two-thirds of the seasoning mix over the top and toss again until coated. Save the remaining third for a finishing sprinkle after baking.",
  },
  {
    title: "Single-layer arrangement (critical)",
    text: "Arrange slices in a single layer on the parchment-lined sheets with no overlapping - even small overlaps create soggy zones. You may need to bake in two rounds depending on your sheet pan size.",
  },
  {
    title: "First bake",
    text: "Slide both sheets into the oven and bake. Set a timer but trust your eyes more - you're looking for edges starting to curl and turn golden.",
  },
  {
    title: "Rotate and rescue early finishers",
    text: "Swap the pans top to bottom and rotate each pan 180 degrees. If any chips are already golden brown, pull them now and set aside - the smallest slices always finish first.",
  },
  {
    title: "Second bake (watch like a hawk)",
    text: "Return to the oven and bake until evenly golden. The window between perfect and burnt is about 6 minutes at this stage. Pull individual chips as they finish if needed. Edges will be a few shades darker than centers; that's correct.",
  },
  {
    title: "Season and cool",
    text: "Pull the pans and immediately sprinkle with the reserved seasoning. Let chips cool on the pans for a few minutes - they crisp dramatically as they cool, going from slightly bendy to shatter-crisp.",
  },
  {
    title: "Taste and surrender",
    text: "Taste one. Adjust salt to your liking. Then accept that you've made something genuinely good for you that you'll absolutely eat all of in one sitting.",
  },
];

const claudeHealthNotes = [
  "About 1 tbsp oil total vs. ~1 cup absorbed in fried chips (~120 cal vs ~900+ cal of fat)",
  "Skin-on means fiber, potassium, vitamin C, and B6 stay in the chip",
  "Nutritional yeast adds protein, fiber, and a full spectrum of B vitamins (including B12 if fortified)",
  "Less than 1g sodium per serving - versus 2-3x that in store-bought",
  "No seed oils if you use olive or avocado oil",
];

const claudeFlavorNotes = [
  "Vinegar & sea salt: 1 tsp malt vinegar powder + extra salt, skip the paprika",
  "Ranch: 1 tsp dried dill + 1/2 tsp dried parsley + extra onion powder",
  "Truffle: Toss with 1/2 tsp truffle oil after baking (a little goes a long way)",
  "Spicy: Add 1/4 tsp cayenne or 1/2 tsp chili powder",
];

const claudeThinkingLine =
  "Engineered crispy oven-baked chips balancing flavor, nutrition, and minimal oil >";
const claudeLedeText =
  "Same shattering crunch, same compulsive umami pull - but oven-baked with about 1/8th the oil of fried chips. The trick is treating baking like dehydration plus browning: drive out every drop of water first, then let the Maillard reaction do its work. Nutritional yeast becomes the secret weapon here - it's loaded with B vitamins and delivers a cheesy-savory hit that masks the fact that you're eating roughly 80% less fat.";
const claudeRecipeSummary =
  "Oven-baked, skin-on, and seasoned with a B-vitamin-packed umami salt - all the addictive crunch with a fraction of the oil.";
const claudeHonestTakeIntro =
  'The honest take on what makes this "healthy but still addictive":';
const claudeHonestTakeItems = [
  {
    lead: "Nutritional yeast does heavy lifting.",
    text: "It hits the same cheese-and-umami receptors that fried fat does, but adds B vitamins and a bit of protein and fiber.",
  },
  {
    lead: "Oil quantity, not type, is the main health lever.",
    text: "Going from 1 cup of absorbed oil to 1 tablespoon is roughly 800 fewer fat calories per batch.",
  },
  {
    lead: "Skin on, always.",
    text: "Most of a potato's nutrients are in or just under the skin.",
  },
  {
    lead: "The cooling crisp.",
    text: "Baked chips come out of the oven slightly soft and finish crisping as they cool.",
  },
];
const claudeHonestTakeOutro =
  "If you want the absolute most addictive version of this recipe, the air fryer at 360\u00b0F gets you closest to fried texture because the high-velocity airflow crisps surfaces faster than a still oven. The microwave method is the surprise sleeper hit for solo snacking - zero oil, four minutes, genuinely good.";

const geminiEquipment = [
  {
    label: "Mandoline Slicer",
    text: "Even more critical here than in deep frying. If slices are uneven, half will burn before the other half gets crispy. Set to 1/16 inch.",
  },
  {
    label: "Large Baking Sheets",
    text: "You need surface area. Crowding the pan creates steam, and steam is the enemy of crunch.",
  },
  {
    label: "Parchment Paper",
    text: "Prevents sticking without needing extra oil.",
  },
  {
    label: "Pastry Brush or Oil Spritzer",
    text: "For highly controlled, even oil distribution.",
  },
];

const geminiChipIngredients = [
  "2 lbs Russet Potatoes: Scrubbed, skin-on.",
  "1.5 tablespoons Avocado Oil or Extra Virgin Olive Oil: Avocado oil is great for its neutral flavor and high heat tolerance.",
  "1 tablespoon Sea Salt (for drawing out moisture).",
];

const geminiSeasoningIngredients = [
  "2 tbsp Nutritional Yeast",
  "1 tsp Fine Sea Salt",
  "1/2 tsp Garlic Powder",
  "1/2 tsp Onion Powder",
  "1/4 tsp Smoked Paprika",
  "1/4 tsp Chili Powder (optional, for a tiny kick)",
];

function revealProps(order: number, className?: string) {
  return {
    className: className
      ? `recipe-response-reveal ${className}`
      : "recipe-response-reveal",
    style: { "--recipe-reveal-index": order } as RevealStyle,
  };
}

function revealLineProps(order: number) {
  return {
    className: "recipe-response-reveal-line",
    style: { "--recipe-reveal-index": order } as RevealStyle,
  };
}

function revealListItemProps(order: number) {
  return {
    className: "recipe-response-reveal-list-item",
    style: { "--recipe-reveal-index": order } as RevealStyle,
  };
}

function getRevealIndexRange(node: HTMLElement) {
  let minRevealIndex = Number.POSITIVE_INFINITY;
  let maxRevealIndex = 0;

  node.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((element) => {
    const revealIndex = Number.parseFloat(
      element.style.getPropertyValue("--recipe-reveal-index"),
    );

    if (Number.isFinite(revealIndex)) {
      minRevealIndex = Math.min(minRevealIndex, revealIndex);
      maxRevealIndex = Math.max(maxRevealIndex, revealIndex);
    }
  });

  return {
    max: maxRevealIndex,
    min: Number.isFinite(minRevealIndex) ? minRevealIndex : 0,
  };
}

function setClaudeCardGrowthMetrics(root: HTMLElement) {
  const card = root.querySelector<HTMLElement>(".claude-recipe-card");
  const imageBlock = root.querySelector<HTMLElement>(
    ".claude-recipe-card .claude-web-results",
  );

  if (!card || !imageBlock) {
    return;
  }

  const cardRect = card.getBoundingClientRect();
  const imageBlockRect = imageBlock.getBoundingClientRect();
  const cardStyles = globalThis.getComputedStyle(card);
  const bottomPadding = Number.parseFloat(cardStyles.paddingBottom) || 0;
  const startHeight = Math.ceil(
    imageBlockRect.bottom - cardRect.top + bottomPadding,
  );
  const cardRevealRange = getRevealIndexRange(card);
  const imageRevealRange = getRevealIndexRange(imageBlock);
  const growStartIndex = Math.min(
    cardRevealRange.max,
    imageRevealRange.max + 1,
  );
  const growDelay =
    REVEAL_INITIAL_DELAY_MS + growStartIndex * REVEAL_STAGGER_MS;
  const growDuration = Math.max(
    REVEAL_LINE_DURATION_MS,
    (cardRevealRange.max - growStartIndex) * REVEAL_STAGGER_MS +
      REVEAL_LINE_DURATION_MS,
  );

  card.style.setProperty(
    "--claude-card-start-height",
    `${Math.max(0, startHeight)}px`,
  );
  card.style.setProperty(
    "--claude-card-end-height",
    `${Math.max(startHeight, Math.ceil(card.scrollHeight))}px`,
  );
  card.style.setProperty("--claude-card-grow-delay", `${growDelay}ms`);
  card.style.setProperty("--claude-card-grow-duration", `${growDuration}ms`);
}

function getRevealCompletionDelay(node: HTMLElement) {
  let maxRevealIndex = 0;

  node.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((element) => {
    const revealIndex = Number.parseFloat(
      element.style.getPropertyValue("--recipe-reveal-index"),
    );

    if (Number.isFinite(revealIndex)) {
      maxRevealIndex = Math.max(maxRevealIndex, revealIndex);
    }
  });

  return (
    REVEAL_INITIAL_DELAY_MS +
    maxRevealIndex * REVEAL_STAGGER_MS +
    REVEAL_LINE_DURATION_MS +
    REVEAL_COMPLETION_BUFFER_MS
  );
}

function splitRecipeTextIntoLines(text: string) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length > RECIPE_LINE_MAX_LENGTH && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function countRecipeTextLines(items: string[]) {
  return items.reduce(
    (total, item) => total + splitRecipeTextIntoLines(item).length,
    0,
  );
}

function getRecipeLineGroups(items: string[]) {
  const lineGroups = items.map((item) => ({
    item,
    lines: splitRecipeTextIntoLines(item),
  }));

  return lineGroups.map((group, index) => ({
    ...group,
    startOffset: lineGroups
      .slice(0, index)
      .reduce((total, previousGroup) => total + previousGroup.lines.length, 0),
  }));
}

function RecipeBulletList({
  items,
  revealStartIndex,
}: {
  items: string[];
  revealStartIndex?: number;
}) {
  const lineGroups = getRecipeLineGroups(items);

  return (
    <ul>
      {lineGroups.map(({ item, lines, startOffset }) => {
        const lineStartIndex =
          revealStartIndex === undefined
            ? undefined
            : revealStartIndex + startOffset;

        return (
          <li
            key={item}
            {...(lineStartIndex === undefined
              ? {}
              : revealListItemProps(lineStartIndex))}
          >
            {lines.map((line, index) => (
              <span
                key={`${index}-${line}`}
                {...(lineStartIndex === undefined
                  ? { className: "recipe-response-reveal-line" }
                  : revealLineProps(lineStartIndex + index))}
              >
                {line}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function RecipeParagraphs({
  className,
  items,
  revealStartIndex,
}: {
  className?: string;
  items: string[];
  revealStartIndex?: number;
}) {
  const lineGroups = getRecipeLineGroups(items);

  return (
    <>
      {lineGroups.map(({ item, lines, startOffset }) => {
        const lineStartIndex =
          revealStartIndex === undefined
            ? undefined
            : revealStartIndex + startOffset;

        return (
          <p
            className={
              className
                ? `recipe-response-line-group ${className}`
                : "recipe-response-line-group"
            }
            key={item}
          >
            {lines.map((line, index) => (
              <span
                key={`${index}-${line}`}
                {...(lineStartIndex === undefined
                  ? { className: "recipe-response-reveal-line" }
                  : revealLineProps(lineStartIndex + index))}
              >
                {line}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function getStrongLeadLines(lead: string, text: string) {
  return splitRecipeTextIntoLines(`${lead} ${text}`).map((line, index) => {
    if (index === 0 && line.startsWith(lead)) {
      return (
        <>
          <strong>{lead}</strong>
          {line.slice(lead.length)}
        </>
      );
    }

    return line;
  });
}

function countStrongLeadLines(lead: string, text: string) {
  return splitRecipeTextIntoLines(`${lead} ${text}`).length;
}

function RecipeLineGroup({
  className,
  lines,
  revealStartIndex,
}: {
  className?: string;
  lines: ReactNode[];
  revealStartIndex: number;
}) {
  return (
    <p
      className={
        className
          ? `recipe-response-line-group ${className}`
          : "recipe-response-line-group"
      }
    >
      {lines.map((line, index) => (
        <span key={index} {...revealLineProps(revealStartIndex + index)}>
          {line}
        </span>
      ))}
    </p>
  );
}

function GptRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;
  const nextRevealRange = (length: number) => {
    const start = revealIndex;
    revealIndex += length;
    return start;
  };

  return (
    <article className="recipe-chat-response recipe-chat-response--gpt">
      <p {...revealProps(nextReveal(), "recipe-chat-thinking")}>
        Thought for 46s <span aria-hidden="true">&rsaquo;</span>
      </p>

      <h2 {...revealProps(nextReveal())}>
        Healthier &ldquo;can&rsquo;t-stop&rdquo; potato chips
      </h2>

      <RecipeLineGroup
        lines={[
          <>
            These are <strong>air-fried or baked</strong>, use very little oil,
            and get their snack-shop flavor from
          </>,
          <>
            <strong>vinegar, umami, garlic, onion, smoked paprika, and a fine
              seasoning powder</strong>
          </>,
          <>instead of heavy salt or deep frying.</>,
        ]}
        revealStartIndex={nextRevealRange(3)}
      />

      <h3 {...revealProps(nextReveal())}>Ingredients</h3>

      <h4 {...revealProps(nextReveal())}>Chips</h4>
      <RecipeBulletList
        items={chipsIngredients}
        revealStartIndex={nextRevealRange(
          countRecipeTextLines(chipsIngredients),
        )}
      />

      <h4 {...revealProps(nextReveal())}>Healthy addictive seasoning</h4>
      <RecipeBulletList
        items={seasoningIngredients}
        revealStartIndex={nextRevealRange(
          countRecipeTextLines(seasoningIngredients),
        )}
      />

      <h3 {...revealProps(nextReveal())}>Method</h3>
      <RecipeParagraphs
        items={methodSteps}
        revealStartIndex={nextRevealRange(countRecipeTextLines(methodSteps))}
      />

      <h3 {...revealProps(nextReveal())}>
        Air fryer method &mdash; best texture
      </h3>
      <RecipeParagraphs
        items={airFryerSteps}
        revealStartIndex={nextRevealRange(countRecipeTextLines(airFryerSteps))}
      />

      <h3 {...revealProps(nextReveal())}>Oven method</h3>
      <RecipeParagraphs
        items={ovenSteps}
        revealStartIndex={nextRevealRange(countRecipeTextLines(ovenSteps))}
      />

      <h3 {...revealProps(nextReveal())}>Why these taste so good</h3>
      <p {...revealProps(nextReveal())}>
        The vinegar gives a subtle salt-and-vinegar brightness. Nutritional
        yeast adds cheesy umami without actual cheese. Onion powder, garlic
        powder, and smoked paprika create that savory &ldquo;snack aisle&rdquo;
        flavor. A tiny amount of MSG is optional, but it makes them taste more
        satisfying while allowing you to use less salt.
      </p>

      <h3 {...revealProps(nextReveal())}>
        Best variation: healthy sour-cream-and-onion style
      </h3>
      <p {...revealProps(nextReveal())}>Add this to the seasoning:</p>
      <RecipeBulletList
        items={variationIngredients}
        revealStartIndex={nextRevealRange(
          countRecipeTextLines(variationIngredients),
        )}
      />

      <h3 {...revealProps(nextReveal())}>Crispness rules</h3>
      <p {...revealProps(nextReveal())}>
        The three biggest secrets are thin slices, very dry potatoes, and not
        overcrowding. Also, season after cooking, not before, so the seasoning
        stays bright and the chips stay crisp.
      </p>
      <p {...revealProps(nextReveal())}>
        These are best eaten fresh, but once fully cooled, they can be stored in
        an airtight container for about 1 day.
      </p>
    </article>
  );
}

function ClaudeImageStrip({
  revealStartIndex,
}: {
  revealStartIndex: number;
}) {
  return (
    <div className="claude-web-results" aria-label="Results from the web">
      <div className="claude-web-track" tabIndex={0}>
        {claudeWebResults.map(({ alt, label, src }, index) => (
          <figure
            key={label}
            {...revealProps(revealStartIndex + index, "claude-web-card")}
          >
            <Image
              alt={alt}
              fill
              sizes="(max-width: 768px) 84vw, 22rem"
              src={src}
            />
            <figcaption>{label}</figcaption>
          </figure>
        ))}
      </div>
      <p {...revealProps(revealStartIndex + claudeWebResults.length)}>
        Results from the web
      </p>
    </div>
  );
}

function ClaudeRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;
  const nextRevealRange = (length: number) => {
    const start = revealIndex;
    revealIndex += length;
    return start;
  };
  const renderStrongLeadLines = (lead: string, text: string) => (
    <RecipeLineGroup
      lines={getStrongLeadLines(lead, text)}
      revealStartIndex={nextRevealRange(countStrongLeadLines(lead, text))}
    />
  );
  const thinkingRevealStartIndex = nextRevealRange(
    countRecipeTextLines([claudeThinkingLine]),
  );
  const ledeRevealStartIndex = nextRevealRange(
    countRecipeTextLines([claudeLedeText]),
  );
  const recipeCardRevealIndex = nextReveal();

  return (
    <article className="recipe-chat-response recipe-chat-response--claude">
      <RecipeParagraphs
        className="claude-thinking"
        items={[claudeThinkingLine]}
        revealStartIndex={thinkingRevealStartIndex}
      />

      <RecipeParagraphs
        className="claude-lede"
        items={[claudeLedeText]}
        revealStartIndex={ledeRevealStartIndex}
      />

      <section
        className="claude-recipe-card"
        style={
          {
            "--recipe-reveal-index": recipeCardRevealIndex,
          } as RevealStyle
        }
      >
        <span
          aria-hidden="true"
          {...revealProps(recipeCardRevealIndex, "claude-recipe-card-outline")}
        />
        <ClaudeImageStrip
          revealStartIndex={nextRevealRange(claudeWebResults.length + 1)}
        />

        <h2 {...revealProps(nextReveal())}>Perfect Crispy Baked Potato Chips</h2>
        <RecipeParagraphs
          items={[claudeRecipeSummary]}
          revealStartIndex={nextRevealRange(
            countRecipeTextLines([claudeRecipeSummary]),
          )}
        />

        <div className="claude-servings-row">
          <span {...revealProps(nextReveal())}>Servings</span>
          <strong {...revealProps(nextReveal())}>4</strong>
          <button
            {...revealProps(nextReveal(), "claude-cooking-button")}
            type="button"
          >
            Get cooking
          </button>
        </div>

        <h3 {...revealProps(nextReveal())}>Ingredients</h3>
        <div className="claude-ingredient-list">
          <RecipeParagraphs
            items={claudeIngredients}
            revealStartIndex={nextRevealRange(
              countRecipeTextLines(claudeIngredients),
            )}
          />
        </div>

        <h3 {...revealProps(nextReveal())}>Steps</h3>
        <ol className="claude-step-list">
          {claudeSteps.map((step, index) => {
            const lead = `${step.title}:`;
            const lines = getStrongLeadLines(lead, step.text);
            const lineStartIndex = nextRevealRange(lines.length);

            return (
              <li key={step.title} {...revealListItemProps(lineStartIndex)}>
                <span className="claude-step-number">{index + 1}</span>
                <p className="recipe-response-line-group">
                  {lines.map((line, lineIndex) => (
                    <span
                      key={lineIndex}
                      {...revealLineProps(lineStartIndex + lineIndex)}
                    >
                      {line}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ol>

        {(() => {
          const notesRevealIndex = nextReveal();

          return (
            <aside
              className="claude-notes"
              style={
                {
                  "--recipe-reveal-index": notesRevealIndex,
                } as RevealStyle
              }
            >
              <h3 {...revealProps(notesRevealIndex)}>Notes</h3>
              <RecipeLineGroup
                lines={[
                  <strong key="healthy">
                    Why this is genuinely healthier:
                  </strong>,
                ]}
                revealStartIndex={nextRevealRange(1)}
              />
              <RecipeBulletList
                items={claudeHealthNotes}
                revealStartIndex={nextRevealRange(
                  countRecipeTextLines(claudeHealthNotes),
                )}
              />

              {renderStrongLeadLines(
                "Sweet potato variation:",
                "Swap in sweet potatoes for extra beta-carotene and fiber. They're trickier, so drop the oven to 375\u00b0F and watch like a hawk after the 10-minute mark.",
              )}
              {renderStrongLeadLines(
                "Air fryer method:",
                "Same prep through the oil/seasoning toss. Air fry at 360\u00b0F for 8-12 minutes, shaking every 3 minutes, until golden.",
              )}
              {renderStrongLeadLines(
                "Microwave method (oil-free!):",
                "Skip the oil entirely. Lay dried slices on parchment, sprinkle with seasoning, and microwave on high for 4-6 minutes, watching closely.",
              )}
              {renderStrongLeadLines(
                "Storage:",
                "Cool completely before storing in an airtight container at room temp for up to 3 days. Re-crisp in a 300\u00b0F oven for 2-3 minutes.",
              )}
              <RecipeLineGroup
                lines={[
                  <>
                    <strong>Flavor variations</strong> (replace the spice mix):
                  </>,
                ]}
                revealStartIndex={nextRevealRange(1)}
              />
              <RecipeBulletList
                items={claudeFlavorNotes}
                revealStartIndex={nextRevealRange(
                  countRecipeTextLines(claudeFlavorNotes),
                )}
              />
            </aside>
          );
        })()}
      </section>

      <section className="claude-honest-take">
        <RecipeParagraphs
          className="claude-honest-take-title"
          items={[claudeHonestTakeIntro]}
          revealStartIndex={nextRevealRange(
            countRecipeTextLines([claudeHonestTakeIntro]),
          )}
        />
        <ol>
          {claudeHonestTakeItems.map((item) => {
            const lines = getStrongLeadLines(item.lead, item.text);
            const lineStartIndex = nextRevealRange(lines.length);

            return (
              <li key={item.lead} {...revealListItemProps(lineStartIndex)}>
                <p className="recipe-response-line-group">
                  {lines.map((line, lineIndex) => (
                    <span
                      key={lineIndex}
                      {...revealLineProps(lineStartIndex + lineIndex)}
                    >
                      {line}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ol>
        <RecipeParagraphs
          items={[claudeHonestTakeOutro]}
          revealStartIndex={nextRevealRange(
            countRecipeTextLines([claudeHonestTakeOutro]),
          )}
        />
      </section>
    </article>
  );
}

function GeminiRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;
  const nextRevealRange = (length: number) => {
    const start = revealIndex;
    revealIndex += length;
    return start;
  };

  return (
    <article className="recipe-chat-response recipe-chat-response--gemini">
      <div {...revealProps(nextReveal(), "gemini-thinking")}>
        <span className="gemini-thinking__spark" aria-hidden="true">
          ✦
        </span>
        <span>Show thinking</span>
        <svg
          className="gemini-thinking__chevron"
          aria-hidden="true"
          viewBox="0 0 16 16"
        >
          <path d="M4.5 6.25 8 9.75l3.5-3.5" />
        </svg>
      </div>

      <p {...revealProps(nextReveal())}>
        To make a potato chip that is healthy <em>without</em> sacrificing that
        addictive, shatteringly crisp texture, we have to change our approach.
      </p>
      <p {...revealProps(nextReveal())}>
        The biggest trap with baked or air-fried chips is that they often turn
        out either soggy and leathery, or burnt and bitter. Without a deep vat
        of oil to instantly fry out the water, we have to manage the
        potato&apos;s moisture manually.
      </p>
      <p {...revealProps(nextReveal())}>
        By using a minimal amount of heart-healthy oil and swapping in a
        nutrient-dense, high-umami seasoning blend, you get all the crunch and
        crave-ability with a fraction of the calories.
      </p>

      <hr {...revealProps(nextReveal())} />

      <h3 {...revealProps(nextReveal())}>🛠️ The Essential Equipment</h3>
      <ul>
        {geminiEquipment.map((item) => (
          <li key={item.label} {...revealProps(nextReveal())}>
            <strong>{item.label}:</strong> {item.text}
          </li>
        ))}
      </ul>

      <h3 {...revealProps(nextReveal())}>🥔 The Ingredients</h3>
      <h4 {...revealProps(nextReveal())}>The Chips:</h4>
      <RecipeBulletList
        items={geminiChipIngredients}
        revealStartIndex={nextRevealRange(
          countRecipeTextLines(geminiChipIngredients),
        )}
      />

      <h4 {...revealProps(nextReveal())}>
        The &quot;Healthy Clean-Umami&quot; Seasoning Dust:
      </h4>
      <p {...revealProps(nextReveal())}>
        To get that addictive quality without excess fat or sugar, we use
        Nutritional Yeast (often called &quot;nooch&quot;). It&apos;s packed
        with B-vitamins, protein, and naturally mimics a rich, savory,
        cheddar-like flavor.
      </p>
      <RecipeBulletList
        items={geminiSeasoningIngredients}
        revealStartIndex={nextRevealRange(
          countRecipeTextLines(geminiSeasoningIngredients),
        )}
      />

      <h3 {...revealProps(nextReveal())}>🍳 Step-by-Step Instructions</h3>

      <h4 {...revealProps(nextReveal())}>
        1. Slice and Salt-Sweat (The Moisture Hack)
      </h4>
      <p {...revealProps(nextReveal())}>
        Slice your potatoes on the mandoline directly into a colander.
      </p>
      <p {...revealProps(nextReveal())}>
        Toss the raw slices with 1 tablespoon of sea salt and let them sit in
        the sink for 15 to 20 minutes.
      </p>
      <p {...revealProps(nextReveal())}>
        <strong>Why?</strong> The salt draws out the interior water of the
        potato through osmosis while slightly softening the cell walls. This
        allows them to bake up crispy instead of hard and glassy.
      </p>
      <p {...revealProps(nextReveal())}>
        Rinse the potatoes thoroughly with cold water to wash away the excess
        salt and extracted starch.
      </p>

      <h4 {...revealProps(nextReveal())}>2. Bone Dry is the Goal</h4>
      <p {...revealProps(nextReveal())}>
        Spread the rinsed slices out on clean, highly absorbent kitchen towels.
      </p>
      <p {...revealProps(nextReveal())}>
        Pat them down aggressively. Let them air dry for a few minutes if
        necessary. If there is any surface moisture left, your chips will steam
        instead of crisp.
      </p>

      <h4 {...revealProps(nextReveal())}>3. The Micro-Oil Coating</h4>
      <p {...revealProps(nextReveal())}>
        Preheat your oven to 400&deg;F (200&deg;C). Place your oven racks in
        the upper-middle and lower-middle positions.
      </p>
      <p {...revealProps(nextReveal())}>
        Transfer the dry potato slices to a large, dry bowl. Drizzle with the
        1.5 tablespoons of avocado oil.
      </p>
      <p {...revealProps(nextReveal())}>
        Use your hands to massage the slices, ensuring every single chip has a
        microscopic film of oil on both sides.
      </p>

      <h4 {...revealProps(nextReveal())}>4. The Bake</h4>
      <p {...revealProps(nextReveal())}>
        Line your baking sheets with parchment paper. Lay the slices out in a
        single, un-overlapped layer.
      </p>
      <p {...revealProps(nextReveal())}>
        Bake for 10 to 12 minutes, then pull the trays out and gently flip the
        chips using tongs. Rotate the trays (top rack to bottom, bottom to top)
        when you put them back in.
      </p>
      <p {...revealProps(nextReveal())}>
        Bake for another 5 to 8 minutes. Keep a very close eye on them during
        the last 3 minutes&mdash;baked chips go from golden-crisp to burnt in
        seconds.
      </p>

      <h4 {...revealProps(nextReveal())}>5. Season and Crisp</h4>
      <p {...revealProps(nextReveal())}>
        Remove the trays from the oven when the chips are golden brown and the
        edges are slightly curled.
      </p>
      <p {...revealProps(nextReveal())}>
        Immediately sprinkle generously with the Healthy Clean-Umami Seasoning
        Dust while the chips are hot.
      </p>
      <p {...revealProps(nextReveal())}>
        Let them cool directly on the baking sheet for 5 minutes. As the
        remaining trace steam escapes during cooling, they will lock into their
        final, addictive crunch.
      </p>
    </article>
  );
}

export function RecipeChatTranscript() {
  const [selectedModel] = useState<RecipeModel>("claude");
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [revealedModels, setRevealedModels] = useState<RecipeModel[]>([]);
  const revealCompletionTimerRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const selectedModelLabel = modelOptions.find(
    (option) => option.id === selectedModel,
  )?.label ?? "Opus 4.7 Adaptive";
  const hasRevealedSelectedModel = revealedModels.includes(selectedModel);
  const shouldRevealSelectedModel =
    hasEnteredViewport && !hasRevealedSelectedModel;

  const markModelRevealed = useCallback((model: RecipeModel) => {
    setRevealedModels((currentModels) => {
      if (currentModels.includes(model)) {
        return currentModels;
      }

      return [...currentModels, model];
    });
  }, []);

  const clearRevealCompletionTimer = useCallback(() => {
    if (revealCompletionTimerRef.current === null) {
      return;
    }

    globalThis.clearTimeout(revealCompletionTimerRef.current);
    revealCompletionTimerRef.current = null;
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;

    if (!node) {
      return;
    }

    const supportsIntersectionObserver =
      typeof globalThis.IntersectionObserver !== "undefined";

    if (!supportsIntersectionObserver) {
      const frame = globalThis.requestAnimationFrame(() => {
        setHasEnteredViewport(true);
      });

      return () => {
        globalThis.cancelAnimationFrame(frame);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "0px 0px 28% 0px",
        threshold: 0.04,
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    clearRevealCompletionTimer();

    if (!shouldRevealSelectedModel) {
      return;
    }

    const reducedMotionQuery = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );

    if (reducedMotionQuery?.matches) {
      revealCompletionTimerRef.current = globalThis.setTimeout(() => {
        revealCompletionTimerRef.current = null;
        markModelRevealed(selectedModel);
      }, 0);
      return;
    }

    const node = transcriptRef.current;
    const revealCompletionDelay =
      node === null ? 0 : getRevealCompletionDelay(node);
    const modelBeingRevealed = selectedModel;
    revealCompletionTimerRef.current = globalThis.setTimeout(() => {
      revealCompletionTimerRef.current = null;
      markModelRevealed(modelBeingRevealed);
    }, revealCompletionDelay);

    return () => {
      clearRevealCompletionTimer();
    };
  }, [
    clearRevealCompletionTimer,
    markModelRevealed,
    selectedModel,
    shouldRevealSelectedModel,
  ]);

  useLayoutEffect(() => {
    const node = transcriptRef.current;

    if (!node || selectedModel !== "claude") {
      return;
    }

    const updateClaudeCardGrowth = () => {
      setClaudeCardGrowthMetrics(node);
    };

    updateClaudeCardGrowth();
    globalThis.addEventListener("resize", updateClaudeCardGrowth);

    return () => {
      globalThis.removeEventListener("resize", updateClaudeCardGrowth);
    };
  }, [hasRevealedSelectedModel, selectedModel, shouldRevealSelectedModel]);

  return (
    <div
      className={`recipe-chat-transcript recipe-chat-transcript--${selectedModel}${
        shouldRevealSelectedModel ? " is-revealing" : ""
      }${
        hasEnteredViewport && hasRevealedSelectedModel ? " has-revealed" : ""
      }`}
      aria-label={`${selectedModelLabel} potato chips recipe conversation`}
      ref={transcriptRef}
    >
      <h2 className="mb-[clamp(1.75rem,3vw,2.5rem)] text-center font-sans text-[clamp(2.2rem,4vw,4.35rem)] font-light leading-[1.02] tracking-[-0.04em] text-black">
        Our Heartwarming Story.
      </h2>

      <div className="recipe-chat-prompt-row">
        <p
          className={`recipe-chat-prompt recipe-chat-prompt--${selectedModel}`}
          key={`prompt-${selectedModel}`}
        >
          {PROMPT}
        </p>
      </div>

      {selectedModel === "gpt" ? <GptRecipeResponse /> : null}
      {selectedModel === "claude" ? <ClaudeRecipeResponse /> : null}
      {selectedModel === "gemini" ? <GeminiRecipeResponse /> : null}
    </div>
  );
}
