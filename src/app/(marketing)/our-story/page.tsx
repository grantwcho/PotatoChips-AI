import type { Metadata } from "next";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import { RecipeChatTranscript } from "@/components/recipe-chat-transcript";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "Read the Potato Chips AI origin story through our animated AI recipe chat.",
};

const STORY_TITLE_REVEAL_SPEED = 0.5;

export default function OurStoryPage() {
  return (
    <div className="marketing-story-page marketing-page-light">
      <div className="marketing-container">
        <div className="marketing-rail">
          <h1 className="marketing-story-heading">
            <CharacterTextReveal
              characterSpeed={STORY_TITLE_REVEAL_SPEED}
              lineSpeed={STORY_TITLE_REVEAL_SPEED}
              text="Our Heartwarming Story."
            />
          </h1>
          <RecipeChatTranscript showTitle={false} />
        </div>
      </div>
    </div>
  );
}
