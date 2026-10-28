--- A post for a website: its reference list taken out of its text.
---
--- In the Open sends a site the post's text as Markdown and every work it
--- cites as an entry of its own, which the site lists as it likes: the
--- references extension, in In the Open's docs/micropub.md. Citeproc, with
--- link-citations, has linked each citation to its entry, `#ref-<key>`, and
--- put the entries in a Div, `#refs`, at the end. This takes that Div out of
--- the text, and writes its entries, in their order, as JSON to the file the
--- metadata's `references-out` names:
---
---   [{"key": "a", "text": "A, Ann. 2024. *First Things*. Brill.", "url": "https://doi.org/10.1163/example"}]
---
--- Each entry's text is written as CommonMark without raw HTML: emphasis and
--- links, and the words of anything else, such as small capitals. Its url is
--- the work's DOI, as a link, or else its URL, or none.
---
--- Runs after `--citeproc`, and before `after-citeproc.lua`, which clears the
--- bibliography this reads the DOIs from.

--- Where each work can be found, by its key.
local function addresses(doc)
  local found = {}
  for _, item in ipairs(pandoc.utils.references(doc)) do
    local doi = item.doi and pandoc.utils.stringify(item.doi) or ''
    local url = item.url and pandoc.utils.stringify(item.url) or ''
    if doi ~= '' then
      found[item.id] = 'https://doi.org/' .. doi
    elseif url ~= '' then
      found[item.id] = url
    end
  end
  return found
end

function Pandoc(doc)
  local out = doc.meta['references-out'] and pandoc.utils.stringify(doc.meta['references-out']) or ''
  if out == '' then return nil end
  local urls = addresses(doc)

  local entries = {}
  doc.blocks = doc.blocks:walk {
    Div = function(div)
      if div.identifier ~= 'refs' then return nil end
      for _, entry in ipairs(div.content) do
        local key = entry.t == 'Div' and entry.identifier:match('^ref%-(.+)$')
        if key then
          local text = pandoc.write(pandoc.Pandoc(entry.content), 'commonmark-raw_html', { wrap_text = 'wrap-none' })
          entries[#entries + 1] = { key = key, text = (text:gsub('^%s+', ''):gsub('%s+$', '')), url = urls[key] }
        end
      end
      return {}
    end,
  }

  local file = io.open(out, 'w')
  if not file then error("Couldn't write the post's reference list to a temporary file (" .. out .. "). Try again, and if it keeps happening, please open an issue.", 0) end
  -- An empty list as [], not as the {} an empty Lua table would be.
  file:write(#entries == 0 and '[]' or pandoc.json.encode(entries))
  file:close()

  -- The path is the plugin's, not the post's.
  doc.meta['references-out'] = nil
  return doc
end
