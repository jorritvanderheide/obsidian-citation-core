--- Obsidian's own syntax that pandoc reads as something else, and that has
--- nothing to do with citations. The Due Credit plugin runs this before the
--- citation filter.

--- A callout's marker: `[!note]`, folded `[!note]-` or open `[!note]+`, and
--- `[!note|wide]` with its settings.
local function marker(el)
  return el ~= nil and el.t == 'Str' and el.text:match('^%[![^%]]+%][+-]?$') ~= nil
end

--- A callout, `> [!note] Title`, which pandoc reads as a quote whose first
--- paragraph opens with the marker, the title running to the first line break.
--- The quote stays, with the title in bold on its first line and the type
--- gone; a callout without a title loses the marker only.
function BlockQuote(quote)
  local first = quote.content[1]
  if first == nil or (first.t ~= 'Para' and first.t ~= 'Plain') then return nil end
  local inlines = first.content
  if not marker(inlines[1]) then return nil end

  local i = 2
  if inlines[i] and inlines[i].t == 'Space' then i = i + 1 end
  local title = pandoc.Inlines({})
  while inlines[i] and inlines[i].t ~= 'SoftBreak' and inlines[i].t ~= 'LineBreak' do
    title:insert(inlines[i])
    i = i + 1
  end
  local rest = pandoc.Inlines({})
  for j = i + 1, #inlines do rest:insert(inlines[j]) end

  local opening = pandoc.Inlines({})
  if #title > 0 then
    opening:insert(pandoc.Strong(title))
    if #rest > 0 then opening:insert(pandoc.LineBreak()) end
  end
  opening:extend(rest)
  local blocks = pandoc.Blocks({})
  if #opening > 0 then blocks:insert(pandoc.Para(opening)) end
  for j = 2, #quote.content do blocks:insert(quote.content[j]) end
  quote.content = blocks
  return quote
end

--- A highlight, `==text==`, which pandoc's `mark` extension reads as a span.
--- A LaTeX body is pasted into a journal's class, which does not load the
--- `soul` package its `\hl` needs, so there it is plain text. A PDF, which is
--- `latex` to a filter too, keeps it: pandoc's own template loads `soul`.
function Span(span)
  if not span.classes:includes('mark') or FORMAT ~= 'latex' then return nil end
  local output = (PANDOC_STATE.output_file or ''):lower()
  if output:match('%.pdf$') then return nil end
  return span.content
end

--- An image with an italic line right under it, `![[bed.png|Wooden bed]]`
--- and `*A raised bed in March.*` on the next line: a figure, captioned with
--- the italic line, the image keeping its alt text. Obsidian has no captions,
--- and this is how one looks there. An image without one stays an image, since
--- its alt text is for whoever can't see it, and no caption.
---
--- A Markdown export leaves the paragraph as it is, the way Obsidian shows it:
--- pandoc's Markdown has figures only in a recent pandoc, and an older one left
--- the caption out altogether. A post in GitHub's Markdown, which has no
--- figures, gets the image and its caption as two paragraphs, the caption in
--- italics: how a site finds a figure in a post (In the Open's
--- `docs/micropub.md`, Links and images).
---
--- A post's math alone in its paragraph, the code `Math` made of it, is a
--- code block.
function Para(para)
  local inlines = para.content
  if #inlines == 1 and inlines[1].t == 'Code' and inlines[1].classes:includes('display-math') then
    return pandoc.CodeBlock(inlines[1].text)
  end
  if #inlines ~= 3 or inlines[1].t ~= 'Image' or inlines[3].t ~= 'Emph' then return nil end
  if inlines[2].t ~= 'SoftBreak' and inlines[2].t ~= 'LineBreak' then return nil end
  if FORMAT == 'markdown' then return nil end
  local image, caption = inlines[1], inlines[3].content
  if FORMAT == 'gfm' then
    return { pandoc.Para({ image }), pandoc.Para({ pandoc.Emph(caption) }) }
  end
  return pandoc.Figure({ pandoc.Plain({ image }) }, { long = { pandoc.Plain(caption) } })
end

--- Math, `$…$` or `$$…$$`, in a post: as written, in code. A site draws no
--- math. GitHub's Markdown would write it in a form only GitHub draws, and
--- HTML would spell out what it could in letters and signs and leave the rest
--- as LaTeX. Math on its own, `$$` in a paragraph of its own, is a code block
--- (`Para`). A document keeps its math.
function Math(math)
  if FORMAT ~= 'gfm' and FORMAT ~= 'html' then return nil end
  if math.mathtype == 'InlineMath' then return pandoc.Code('$' .. math.text .. '$') end
  return pandoc.Code('$$' .. math.text .. '$$', pandoc.Attr('', { 'display-math' }))
end

--- What `Math` marked math on its own with, gone from math inside a
--- paragraph, after `Para` has read it.
function Pandoc(doc)
  if FORMAT ~= 'gfm' and FORMAT ~= 'html' then return nil end
  return doc:walk({
    Code = function(code)
      if not code.classes:includes('display-math') then return nil end
      code.classes = {}
      return code
    end,
  })
end
