use anyhow::{Context, Result, anyhow};
use clap::Parser;
use rbx_dom_weak::{WeakDom, types::Ref};
use std::fs::File;
use std::io::BufReader;
use std::io::BufWriter;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long)]
    target: PathBuf,
    #[arg(short, long)]
    base: PathBuf,
    #[arg(short, long)]
    output: PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let base_dom = loadbin(&args.base).context("failed to load base model")?;
    let mut target_dom = loadbin(&args.target).context("failed to load target model")?;
    let (deepest_ref, _) = deepestdom(&target_dom);
    let base_root_children = base_dom.root().children().to_vec();
    for child_ref in base_root_children {
        copyjew(&base_dom, child_ref, &mut target_dom, deepest_ref);
    }
    let output_file = File::create(&args.output)?;
    let writer = BufWriter::new(output_file);
    let root_refs = target_dom.root().children().to_vec();
    rbx_binary::to_writer(writer, &target_dom, &root_refs)?;
    Ok(())
}
fn loadbin(path: &PathBuf) -> Result<WeakDom> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    match rbx_binary::from_reader(reader) {
        Ok(dom) => Ok(dom),
        Err(e) => Err(anyhow!("failed to decode rbxm: {}", e))
    }
}
fn deepestdom(dom: &WeakDom) -> (Ref, usize) {
    let root_children = dom.root().children().to_vec();
    let mut deepest_ref = dom.root_ref();
    let mut max_depth = 0;

    for child in root_children {
        let (node, depth) = finddeep(dom, child, 1);
        if depth > max_depth {
            max_depth = depth;
            deepest_ref = node;
        }
    }
    (deepest_ref, max_depth)
}
fn finddeep(dom: &WeakDom, current_ref: Ref, current_depth: usize) -> (Ref, usize) {
    let instance = match dom.get_by_ref(current_ref) {
        Some(inst) => inst,
        None => return (current_ref, current_depth),
    };
    if instance.children().is_empty() {
        return (current_ref, current_depth);
    }
    let mut best_node = current_ref;
    let mut best_depth = current_depth;
    for &child in instance.children() {
        let (deepest_in_branch, depth) = finddeep(dom, child, current_depth + 1);
        if depth > best_depth {
            best_depth = depth;
            best_node = deepest_in_branch;
        }
    }
    (best_node, best_depth)
}
fn copyjew(
    source_dom: &WeakDom,
    source_ref: Ref,
    dest_dom: &mut WeakDom,
    dest_parent: Ref
) {
    let source_inst = match source_dom.get_by_ref(source_ref) {
        Some(i) => i,
        None => return,
    };

    let new_inst = rbx_dom_weak::InstanceBuilder::new(&source_inst.class)
        .with_name(&source_inst.name)
        .with_properties(source_inst.properties.clone());

    let new_ref = dest_dom.insert(dest_parent, new_inst);

    for &child_ref in source_inst.children() {
        copyjew(source_dom, child_ref, dest_dom, new_ref);
    }
}