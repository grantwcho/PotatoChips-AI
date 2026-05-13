"use client";

import Image, { type StaticImageData } from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import claudeChip55Recipes from "../../assets/images/claude-chip-55recipes.webp";
import claudeChipInspired from "../../assets/images/claude-chip-inspired.jpg";
import claudeChipMummyrecipes from "../../assets/images/claude-chip-mummyrecipes.jpg";

const PROMPT =
  "Give me the most perfect, best-tasting, addictive, but healthy potato chips recipe.";

type RecipeModel = "gpt" | "claude" | "gemini";

type RevealStyle = CSSProperties & {
  "--recipe-reveal-index": number;
};

function ChatGptLogoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="recipe-model-toggle__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M9.45 4.2a4.15 4.15 0 0 1 6.95 2.1 4.18 4.18 0 0 1 2.2 6.92 4.16 4.16 0 0 1-3.53 6.02 4.17 4.17 0 0 1-7.08.54 4.16 4.16 0 0 1-2.33-6.88A4.17 4.17 0 0 1 9.45 4.2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M8.03 7.88 12 5.6l3.97 2.28M5.98 12.98V8.46l3.93-2.3M8.03 16.12l-3.97-2.28v-4.6M15.97 16.12 12 18.4l-3.97-2.28M18.02 11.02v4.52l-3.93 2.3M15.97 7.88l3.97 2.28v4.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
      <path
        d="m12 8.9 2.68 1.55v3.1L12 15.1l-2.68-1.55v-3.1L12 8.9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function ClaudeLogoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="recipe-model-toggle__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 3.8v16.4M5.25 7.1l13.5 9.8M18.75 7.1l-13.5 9.8M3.9 12h16.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.1"
      />
      <circle cx="12" cy="12" fill="currentColor" r="2.05" />
    </svg>
  );
}

function GeminiLogoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="recipe-model-toggle__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 2.9c.9 4.75 3.45 7.3 8.2 8.1-4.75.9-7.3 3.45-8.2 8.2-.9-4.75-3.45-7.3-8.2-8.2 4.75-.8 7.3-3.35 8.2-8.1Z"
        fill="currentColor"
      />
      <path
        d="M18.35 16.65c.3 1.55 1.15 2.4 2.7 2.7-1.55.3-2.4 1.15-2.7 2.7-.3-1.55-1.15-2.4-2.7-2.7 1.55-.3 2.4-1.15 2.7-2.7Z"
        fill="currentColor"
        opacity="0.72"
      />
    </svg>
  );
}

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
  Icon: () => ReactElement;
  id: RecipeModel;
  label: string;
}> = [
  { Icon: ChatGptLogoIcon, id: "gpt", label: "GPT-5.5 Pro" },
  { Icon: ClaudeLogoIcon, id: "claude", label: "Opus 4.7 Adaptive" },
  { Icon: GeminiLogoIcon, id: "gemini", label: "Gemini 3.1 Pro" },
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

function RecipeBulletList({
  getRevealIndex,
  items,
}: {
  getRevealIndex?: () => number;
  items: string[];
}) {
  return (
    <ul>
      {items.map((item) => {
        const order = getRevealIndex?.();

        return (
          <li
            key={item}
            {...(order === undefined ? {} : revealProps(order))}
          >
            {item}
          </li>
        );
      })}
    </ul>
  );
}

function RecipeParagraphs({
  getRevealIndex,
  items,
}: {
  getRevealIndex?: () => number;
  items: string[];
}) {
  return (
    <>
      {items.map((item) => {
        const order = getRevealIndex?.();

        return (
          <p
            key={item}
            {...(order === undefined ? {} : revealProps(order))}
          >
            {item}
          </p>
        );
      })}
    </>
  );
}

function GptRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;

  return (
    <article className="recipe-chat-response recipe-chat-response--gpt">
      <p {...revealProps(nextReveal(), "recipe-chat-thinking")}>
        Thought for 46s <span aria-hidden="true">&rsaquo;</span>
      </p>

      <h2 {...revealProps(nextReveal())}>
        Healthier &ldquo;can&rsquo;t-stop&rdquo; potato chips
      </h2>

      <p {...revealProps(nextReveal())}>
        These are <strong>air-fried or baked</strong>, use very little oil, and
        get their snack-shop flavor from{" "}
        <strong>
          vinegar, umami, garlic, onion, smoked paprika, and a fine seasoning
          powder
        </strong>{" "}
        instead of heavy salt or deep frying.
      </p>

      <h3 {...revealProps(nextReveal())}>Ingredients</h3>

      <h4 {...revealProps(nextReveal())}>Chips</h4>
      <RecipeBulletList
        getRevealIndex={nextReveal}
        items={chipsIngredients}
      />

      <h4 {...revealProps(nextReveal())}>Healthy addictive seasoning</h4>
      <RecipeBulletList
        getRevealIndex={nextReveal}
        items={seasoningIngredients}
      />

      <h3 {...revealProps(nextReveal())}>Method</h3>
      <RecipeParagraphs getRevealIndex={nextReveal} items={methodSteps} />

      <h3 {...revealProps(nextReveal())}>
        Air fryer method &mdash; best texture
      </h3>
      <RecipeParagraphs getRevealIndex={nextReveal} items={airFryerSteps} />

      <h3 {...revealProps(nextReveal())}>Oven method</h3>
      <RecipeParagraphs getRevealIndex={nextReveal} items={ovenSteps} />

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
        getRevealIndex={nextReveal}
        items={variationIngredients}
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
  getRevealIndex,
}: {
  getRevealIndex: () => number;
}) {
  return (
    <div className="claude-web-results" aria-label="Results from the web">
      <div className="claude-web-track" tabIndex={0}>
        {claudeWebResults.map(({ alt, label, src }) => (
          <figure
            key={label}
            {...revealProps(getRevealIndex(), "claude-web-card")}
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
      <p>Results from the web</p>
    </div>
  );
}

function ClaudeRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;

  return (
    <article className="recipe-chat-response recipe-chat-response--claude">
      <p {...revealProps(nextReveal(), "claude-thinking")}>
        Engineered crispy oven-baked chips balancing flavor, nutrition, and
        minimal oil <span aria-hidden="true">&rsaquo;</span>
      </p>

      <p {...revealProps(nextReveal(), "claude-lede")}>
        Same shattering crunch, same compulsive umami pull &mdash; but
        oven-baked with about 1/8th the oil of fried chips. The trick is
        treating baking like dehydration plus browning: drive out every drop of
        water first, then let the Maillard reaction do its work. Nutritional
        yeast becomes the secret weapon here &mdash; it&apos;s loaded with B
        vitamins and delivers a cheesy-savory hit that masks the fact that
        you&apos;re eating roughly 80% less fat.
      </p>

      <section className="claude-recipe-card">
        <ClaudeImageStrip getRevealIndex={nextReveal} />

        <h2 {...revealProps(nextReveal())}>Perfect Crispy Baked Potato Chips</h2>
        <p {...revealProps(nextReveal())}>
          Oven-baked, skin-on, and seasoned with a B-vitamin-packed umami salt
          &mdash; all the addictive crunch with a fraction of the oil.
        </p>

        <div {...revealProps(nextReveal(), "claude-servings-row")}>
          <span>Servings</span>
          <strong>4</strong>
          <button type="button">Get cooking</button>
        </div>

        <h3 {...revealProps(nextReveal())}>Ingredients</h3>
        <div className="claude-ingredient-list">
          {claudeIngredients.map((ingredient) => (
            <p key={ingredient} {...revealProps(nextReveal())}>
              {ingredient}
            </p>
          ))}
        </div>

        <h3 {...revealProps(nextReveal())}>Steps</h3>
        <ol className="claude-step-list">
          {claudeSteps.map((step, index) => (
            <li key={step.title} {...revealProps(nextReveal())}>
              <span className="claude-step-number">{index + 1}</span>
              <p>
                <strong>{step.title}:</strong> {step.text}
              </p>
            </li>
          ))}
        </ol>

        <aside className="claude-notes">
          <h3 {...revealProps(nextReveal())}>Notes</h3>
          <p {...revealProps(nextReveal())}>
            <strong>Why this is genuinely healthier:</strong>
          </p>
          <RecipeBulletList
            getRevealIndex={nextReveal}
            items={claudeHealthNotes}
          />

          <p {...revealProps(nextReveal())}>
            <strong>Sweet potato variation:</strong> Swap in sweet potatoes for
            extra beta-carotene and fiber. They&apos;re trickier, so drop the
            oven to 375&deg;F and watch like a hawk after the 10-minute mark.
          </p>
          <p {...revealProps(nextReveal())}>
            <strong>Air fryer method:</strong> Same prep through the
            oil/seasoning toss. Air fry at 360&deg;F for 8-12 minutes, shaking
            every 3 minutes, until golden.
          </p>
          <p {...revealProps(nextReveal())}>
            <strong>Microwave method (oil-free!):</strong> Skip the oil
            entirely. Lay dried slices on parchment, sprinkle with seasoning,
            and microwave on high for 4-6 minutes, watching closely.
          </p>
          <p {...revealProps(nextReveal())}>
            <strong>Storage:</strong> Cool completely before storing in an
            airtight container at room temp for up to 3 days. Re-crisp in a
            300&deg;F oven for 2-3 minutes.
          </p>
          <p {...revealProps(nextReveal())}>
            <strong>Flavor variations</strong> (replace the spice mix):
          </p>
          <RecipeBulletList
            getRevealIndex={nextReveal}
            items={claudeFlavorNotes}
          />
        </aside>
      </section>

      <section className="claude-honest-take">
        <h2 {...revealProps(nextReveal())}>
          The honest take on what makes this &quot;healthy but still addictive&quot;:
        </h2>
        <ol>
          <li {...revealProps(nextReveal())}>
            <strong>Nutritional yeast does heavy lifting.</strong> It hits the
            same cheese-and-umami receptors that fried fat does, but adds B
            vitamins and a bit of protein and fiber.
          </li>
          <li {...revealProps(nextReveal())}>
            <strong>Oil quantity, not type, is the main health lever.</strong>{" "}
            Going from 1 cup of absorbed oil to 1 tablespoon is roughly 800
            fewer fat calories per batch.
          </li>
          <li {...revealProps(nextReveal())}>
            <strong>Skin on, always.</strong> Most of a potato&apos;s nutrients
            are in or just under the skin.
          </li>
          <li {...revealProps(nextReveal())}>
            <strong>The cooling crisp.</strong> Baked chips come out of the oven
            slightly soft and finish crisping as they cool.
          </li>
        </ol>
        <p {...revealProps(nextReveal())}>
          If you want the absolute most addictive version of this recipe, the
          air fryer at 360&deg;F gets you closest to fried texture because the
          high-velocity airflow crisps surfaces faster than a still oven. The
          microwave method is the surprise sleeper hit for solo snacking &mdash;
          zero oil, four minutes, genuinely good.
        </p>
      </section>
    </article>
  );
}

function GeminiRecipeResponse() {
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;

  return (
    <article className="recipe-chat-response recipe-chat-response--gemini">
      <div {...revealProps(nextReveal(), "gemini-thinking")}>
        <span className="gemini-thinking__spark" aria-hidden="true">
          ✦
        </span>
        <span>Show thinking</span>
        <span aria-hidden="true">⌄</span>
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
        getRevealIndex={nextReveal}
        items={geminiChipIngredients}
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
        getRevealIndex={nextReveal}
        items={geminiSeasoningIngredients}
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
  const [selectedModel, setSelectedModel] = useState<RecipeModel>("gpt");
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const selectedModelLabel = modelOptions.find(
    (option) => option.id === selectedModel,
  )?.label;

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
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.22,
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={`recipe-chat-transcript recipe-chat-transcript--${selectedModel}${
        hasEnteredViewport ? " is-revealing" : ""
      }`}
      aria-label={`${selectedModelLabel} potato chips recipe conversation`}
      ref={transcriptRef}
    >
      <div
        aria-label="Select recipe model"
        className="recipe-model-toggle"
        role="tablist"
      >
        {modelOptions.map((option) => {
          const Icon = option.Icon;

          return (
            <button
              aria-selected={selectedModel === option.id}
              className={`recipe-model-toggle__option${
                selectedModel === option.id ? " is-active" : ""
              }`}
              key={option.id}
              onClick={() => setSelectedModel(option.id)}
              role="tab"
              type="button"
            >
              <Icon />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

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
