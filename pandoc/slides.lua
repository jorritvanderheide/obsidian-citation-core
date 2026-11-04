--- A note as slides, once citeproc has run. `slidesOf` in the core's
--- `src/core/slides.ts` has marked where each one ends, and this makes one
--- `.slide` of each, in order, whatever is on it.
---
--- Slides are shown one at a time and can't be turned back to, so what a
--- slide cites and notes is at its own foot, in a `.slide-foot`: the full
--- reference of each work it cites, once, and its footnotes, numbered from 1
--- on each slide. A style that cites in footnotes has already said it in the
--- footnote, page included, so a work cited that way gets no reference as well.
--- The reference list is a `.slide.references` of its own, at the end.

--- Math as MathML, which a window draws without a script, on a slide and in a
--- PDF alike. Written here because no option works on every pandoc this runs
--- on: `--math-method` is too new for the oldest, and the newest warns about
--- `--mathml`.
local function mathml(math)
  local html = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ math }) }), 'html5', { html_math_method = 'mathml' })
  return pandoc.RawInline('html', (html:gsub('%s+$', '')))
end

--- Takes the footnotes out of `blocks`, leaving their numbers, and returns the
--- blocks and the footnotes as a list of block lists.
local function without_notes(blocks)
  local notes = pandoc.List()
  local rest = blocks:walk({
    Note = function(note)
      notes:insert(note.content)
      return pandoc.Superscript({ pandoc.Str(tostring(#notes)) })
    end,
  })
  return rest, notes
end

--- The keys `blocks` cites, each once, in order, without a citation that
--- became a footnote. One in a footnote of yours counts, since its words are at
--- the foot too.
local function cited_keys(blocks)
  local seen, keys = {}, pandoc.List()
  blocks:walk({
    Cite = function(cite)
      local first = cite.content[1]
      if #cite.content == 1 and first.t == 'Note' then return nil end
      for _, citation in ipairs(cite.citations) do
        if not seen[citation.id] then
          seen[citation.id] = true
          keys:insert(citation.id)
        end
      end
    end,
  })
  return keys
end

--- What to put at a slide's foot, or nil for nothing.
local function foot_of(keys, notes, entries)
  local foot = pandoc.Blocks({})
  for _, key in ipairs(keys) do
    local entry = entries['ref-' .. key]
    if entry then foot:insert(pandoc.Div(entry.content, { class = 'slide-reference' })) end
  end
  for number, note in ipairs(notes) do
    local blocks = pandoc.Blocks({ pandoc.Plain({ pandoc.Superscript({ pandoc.Str(tostring(number)) }) }) })
    blocks:extend(note)
    foot:insert(pandoc.Div(blocks, { class = 'slide-note' }))
  end
  if #foot == 0 then return nil end
  return pandoc.Div(foot, { class = 'slide-foot' })
end

function Pandoc(doc)
  -- Not in an image's description, which is plain text.
  doc = doc:walk({
    traverse = 'topdown',
    Math = mathml,
    Image = function(image) return image, false end,
  })
  local slides = pandoc.List({ pandoc.Blocks({}) })
  local closing = pandoc.Blocks({})
  local entries = {}
  for _, block in ipairs(doc.blocks) do
    if block.t == 'Div' and block.classes:includes('slide-break') then
      slides:insert(pandoc.Blocks({}))
    elseif block.t == 'Div' and block.identifier == 'refs' then
      local current = slides[#slides]
      local heading = current[#current]
      -- The heading citeproc gave the list goes along with it.
      if heading and heading.t == 'Header' and heading.classes:includes('unnumbered') then
        closing:insert(heading)
        current:remove(#current)
      end
      closing:insert(block)
      for _, entry in ipairs(block.content) do
        if entry.identifier ~= '' then entries[entry.identifier] = entry end
      end
    else
      slides[#slides]:insert(block)
    end
  end

  local out = pandoc.Blocks({})
  for _, slide in ipairs(slides) do
    local keys = cited_keys(slide)
    local rest, notes = without_notes(slide)
    local foot = foot_of(keys, notes, entries)
    if foot then rest:insert(foot) end
    out:insert(pandoc.Div(rest, { class = 'slide' }))
  end
  if #closing > 0 then out:insert(pandoc.Div(closing, { class = 'slide references' })) end
  doc.blocks = out
  return doc
end
