---
name: slides/lesson-deck
title: Lesson deck
when: slides for teaching: a class, training session, workshop, course or tutorial with explanations and exercises
keywords: lesson, cours, lecon, teaching, enseignement, class, classe, formation, training, workshop, atelier, tutorial, tutoriel, pedagogie, course, module, eleves, students, prof, teacher, revision
---
# Lesson deck

Teaching slides support learning, not just listening: they introduce, explain, check understanding and leave a trace students can revise from.

## Decide first
- Learning objectives: two or three things students will be able to do after the lesson. They go on slide 2.
- Level and prior knowledge.
- Activities: when do students think, answer, practise?

## Build it
1. **Title**: subject, chapter, level.
2. **Objectives**: "By the end you can… ".
3. **Hook**: a question, image or surprising fact.
4. **Explanation blocks**: concept → example → visual. One concept per two or three slides.
5. **Check slides**: a question with choices, then the answer on the next slide.
6. **Practice**: an exercise slide with clear instructions and a time limit.
7. **Summary**: the key points as a list students can copy.
8. **Next**: homework or next lesson.

## Techniques
- **Recognisable slide types** with consistent colours so students know the mode:
```css
.slide.concept { background: var(--ground); }
.slide.check { background: #fff4d6; } .slide.check h2::before { content: "?  "; color: var(--accent); }
.slide.practice { background: #e9f4ec; }
.slide .def { font-size: 34px; border-left: 6px solid var(--accent); padding-left: 24px; }
```
- **Worked example** revealed in steps over several slides.
- **Diagrams** drawn in SVG with labels (svg/diagram), large enough for the back row.
- **Formulas** typed with real symbols, big, with units.
- A small **progress marker** (part 2/4) in a corner.

## Make it distinctive
Use the subject's world: a geography lesson with map colours and contour lines; chemistry with a periodic-table tile motif; literature with a book-like serif and paper tone. Keep it calm: students need to read.

## Avoid
- Copying the textbook onto slides.
- Answers on the same slide as the question.
- Animations that distract.

## Self-check
1. Objectives stated at the start and met at the end?
2. At least one check-for-understanding?
3. Every slide readable from the back (≥ 28px body)?
4. Slide types clearly distinguishable?
5. Summary usable for revision?
